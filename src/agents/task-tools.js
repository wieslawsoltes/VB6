import {McpError, validateArguments, awaitAbort, checkAbort} from '../mcp/protocol.js';

const text = maxLength => ({type: 'string', minLength: 1, maxLength});
const object = (properties, required) => ({type: 'object', properties, required, additionalProperties: false});
const annotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false};

/** Session-local tools. Neither tool grants project permissions or executes project code. */
export function taskTools(agent, askUser) {
  const planSchema = object({
    expectedPlanRevision: {type: 'integer', minimum: 0},
    explanation: {type: 'string', maxLength: 2000},
    steps: {type: 'array', minItems: 1, maxItems: 12, items: object({
      id: {type: 'string', pattern: '^[A-Za-z0-9_-]{1,32}$'}, title: text(240),
      status: {type: 'string', enum: ['pending', 'in_progress', 'completed']}
    }, ['id', 'title', 'status'])}
  }, ['expectedPlanRevision', 'steps']);
  const tools = [{
    name: 'vb6.agent.plan', annotations, inputSchema: planSchema,
    description: 'Update this task\'s visible plan, not the project. Use stable step IDs, at most one in_progress step, and expectedPlanRevision (initially 0). Plans are model-reported progress, not validation evidence or authorization.',
    execute(args, {signal} = {}) {
      checkAbort(signal); validateArguments(args, planSchema);
      if (args.expectedPlanRevision !== agent.plan.revision) throw new McpError(-32002, 'Task plan changed.', {planRevision: agent.plan.revision});
      if (!args.steps.length || args.steps.some(step => !/^[A-Za-z0-9_-]{1,32}$/.test(step.id)) || new Set(args.steps.map(step => step.id)).size !== args.steps.length || args.steps.filter(step => step.status === 'in_progress').length > 1 || args.steps.some(step => !step.title.trim()))
        throw new McpError(-32602, 'Use unique step IDs, nonempty titles and at most one in-progress step.');
      agent.plan = {revision: agent.plan.revision + 1, explanation: args.explanation || '', steps: structuredClone(args.steps)};
      agent.emit('plan', 'Task plan updated (' + agent.plan.steps.filter(step => step.status === 'completed').length + '/' + agent.plan.steps.length + ' complete).', {plan: structuredClone(agent.plan)});
      return structuredClone(agent.plan);
    }
  }];
  if (typeof askUser === 'function') {
    const schema = object({question: text(2000), options: {type: 'array', minItems: 1, maxItems: 6, items: text(200)}}, ['question']);
    tools.push({
      name: 'vb6.agent.question', annotations, inputSchema: schema,
      description: 'Ask the local user a clarifying question and wait for their answer. Optional options are suggestions; free text is allowed. Never request credentials. Answers do not grant edit/execution permissions. Cancellation stops the task.',
      async execute(args, {signal} = {}) {
        checkAbort(signal); validateArguments(args, schema);
        if (!args.question.trim() || (args.options && !args.options.length) || args.options?.some(option => !option.trim()) || (args.options && new Set(args.options).size !== args.options.length)) throw new McpError(-32602, 'Use a nonempty question and distinct nonempty options.');
        // Keep the prompt paired with its answer in public transcripts/handoffs.
        // Only validated public text is recorded; no native history or authority.
        agent.emit('question', args.question);
        const answer = await awaitAbort(Promise.resolve(askUser(structuredClone(args), {signal})), signal);
        checkAbort(signal);
        if (answer === null || answer === undefined || answer === false) throw new McpError(-32001, 'The local user cancelled the question.');
        if (typeof answer !== 'string' || !answer.trim() || answer.length > 8000) throw new McpError(-32602, 'Answer must contain 1–8,000 characters.');
        agent.emit('answer', answer);
        return {answer, grantsPermissions: false};
      }
    });
  }
  return tools;
}
