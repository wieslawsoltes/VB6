// Process-lifetime application registration without a graphical session. MIT.
#pragma once
#include <memory>

namespace vb6 {
class LinuxApplicationInstance {
  struct State;
  std::shared_ptr<State> state;
  static std::shared_ptr<State> acquire();
public:
  LinuxApplicationInstance();
  // Captured at startup. Every live instance retains its own kernel lock, so
  // a surviving secondary instance is still detected by later launches.
  bool previous();
};
}
