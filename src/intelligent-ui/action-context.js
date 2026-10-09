/** Pin UI effects to the original task. Caller-supplied UI data cannot choose a task. */
export function pinUIActionContext(host, {adapter=host.adapter, owner}={}) {
  const task = owner && adapter === host.adapter
    ? [...host.conversations.tasks.values()].find(value => value.agent.sessionKey === owner)
    : host.conversations.active;
  const thread = task?.agent.thread, epoch = host.adapter.workspaceEpoch;
  const assertLive = () => {
    if (!host.enabled || !task || host.conversations.tasks.get(task.id) !== task ||
        host.conversations.active !== task || task.agent.thread !== thread ||
        host.adapter.workspaceEpoch !== epoch)
      throw new Error('This UI belongs to a different task or project session.');
  };
  return {taskId:task?.id, thread, epoch, assertLive,
    transportContext(signal) {
      assertLive(); signal?.throwIfAborted();
      // Both identities come from the trusted owning connection, never from source/args.
      return {principal:owner, sessionKey:owner, signal};
    }
  };
}
