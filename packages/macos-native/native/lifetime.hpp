// Deterministic VB object release at native language boundaries. MIT.
#pragma once
#include "vb6.hpp"
namespace vb6 {
// Deleters only enqueue. User procedures never execute in a C++ destructor.
std::shared_ptr<Instance> makeNativeInstance(Runtime&, Module&);
// A value may outlive its creating frame and the host Runtime. Lazy storage
// keeps this guard, never an owning Instance or an unchecked Runtime pointer.
std::shared_ptr<NativeLifetime> nativeLifetime(Runtime&);
Runtime& requireNativeRuntime(const std::shared_ptr<NativeLifetime>&);
void drainNativeFinalizers(Runtime&);
// Suppress callbacks and invalidate the runtime pointer before any host/module
// teardown. Objects retained by native clients can subsequently release safely.
void stopNativeFinalizers(Runtime&) noexcept;
}
