// Native reference-count finalization. No tracing GC or JavaScript runtime. MIT.
#include "lifetime.hpp"
namespace vb6 {
namespace {
struct ManagedInstance final : Instance {
  ManagedInstance* nextFinalizer = nullptr;
  bool finalized = false;
  ManagedInstance(Runtime& rt, Module& module) : Instance(rt, module) {}
};
// Intrusive chains keep final release, error unwinding and shutdown allocation
// free. A node belongs to exactly one chain and is detached before any callback.
struct Chain {
  ManagedInstance* head = nullptr;
  ManagedInstance* tail = nullptr;
  void append(ManagedInstance* object) noexcept {
    if (tail) tail->nextFinalizer = object;
    else head = object;
    tail = object;
  }
  ManagedInstance* take() noexcept {
    if (!head) return nullptr;
    auto* object = head;
    head = object->nextFinalizer;
    if (!head) tail = nullptr;
    object->nextFinalizer = nullptr;
    return object;
  }
  void append(Chain& other) noexcept {
    if (!other.head) return;
    if (tail) tail->nextFinalizer = other.head;
    else head = other.head;
    tail = other.tail;
    other = {};
  }
  void prepend(Chain& other) noexcept {
    if (!other.head) return;
    other.tail->nextFinalizer = head;
    head = other.head;
    if (!tail) tail = other.tail;
    other = {};
  }
};
}
struct NativeLifetime {
  Runtime* runtime;
  Chain pending, disposal;
  bool disposing = false;
  explicit NativeLifetime(Runtime& value) : runtime(&value) {}
};
namespace {
void discard(NativeLifetime& life, ManagedInstance* object) noexcept {
  life.disposal.append(object);
  if (life.disposing) return;
  life.disposing = true;
  // End and host teardown also avoid recursive C++ destruction of long chains.
  while (auto* item = life.disposal.take()) delete item;
  life.disposing = false;
}
struct ReleaseInstance {
  std::shared_ptr<NativeLifetime> lifetime;
  void operator()(ManagedInstance* object) const noexcept {
    auto* rt = lifetime->runtime;
    if (!rt || rt->ending || object->finalized || !object->initialized ||
        object->initializing || (object->module->kind != "class" &&
        !(object->module->kind == "form" && object->formInitialized && !object->loaded))) {
      discard(*lifetime, object);
      return;
    }
    lifetime->pending.append(object);
  }
};
struct PendingBatch {
  NativeLifetime& lifetime;
  Chain chain;
  explicit PendingBatch(NativeLifetime& life) : lifetime(life), chain(life.pending) {
    life.pending = {};
  }
  ~PendingBatch() { lifetime.pending.append(chain); }
  PendingBatch(const PendingBatch&) = delete;
  PendingBatch& operator=(const PendingBatch&) = delete;
};
}
std::shared_ptr<NativeLifetime> nativeLifetime(Runtime& rt) {
  if (rt.ending || rt.finished) fail(5,"Native program has finished");
  if (!rt.lifetime) rt.lifetime = std::make_shared<NativeLifetime>(rt);
  return rt.lifetime;
}
Runtime& requireNativeRuntime(const std::shared_ptr<NativeLifetime>& life) {
  if (!life || !life->runtime || life->runtime->ending || life->runtime->finished) fail(5,"Native program has finished");
  return *life->runtime;
}
std::shared_ptr<Instance> makeNativeInstance(Runtime& rt, Module& module) {
  auto life=nativeLifetime(rt);
  return std::shared_ptr<ManagedInstance>(new ManagedInstance(rt, module), ReleaseInstance{std::move(life)});
}
void drainNativeFinalizers(Runtime& rt) {
  auto life = rt.lifetime;
  if (!life || !life->runtime || !life->pending.head) return;
  // Detaching the current batch permits nested releases at VB safe points
  // without running an already-pending peer before this finalizer's first line.
  // An exceptional exit requeues every unprocessed node; destructors never call VB.
  PendingBatch batch(*life);
  while (auto* object = batch.chain.take()) {
    {
      object->finalized = true;
      // The old control block has expired. Rebind shared_from_this/Me to a new
      // owning block; escaped Me references remain safe and terminate only once.
      auto self = std::shared_ptr<ManagedInstance>(object, ReleaseInstance{life});
      if (!rt.ending) {
        auto savedError = rt.error;
        const auto event = object->module->kind == "class" ? "class_terminate" :
          object->module->form && object->module->form->type == "MDIForm" ? "mdiform_terminate" : "form_terminate";
        rt.dispatch(self, event);
        rt.error = std::move(savedError);
      }
    }
    // Fields released after the callback finalize before unrelated peers, but
    // use this loop rather than C++ recursion for arbitrarily long field chains.
    batch.chain.prepend(life->pending);
  }
}
void stopNativeFinalizers(Runtime& rt) noexcept {
  auto life = rt.lifetime;
  if (!life) return;
  life->runtime = nullptr;
  while (auto* object = life->pending.take()) discard(*life, object);
}
} // namespace vb6
