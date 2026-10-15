import assert from 'node:assert/strict';

/** Source diagnostics now reject these programs before execution. First assert
 * the complete expected diagnostic list; then exercise the unchanged VM guard
 * against an explicitly unchecked bytecode input. This helper is test-only:
 * production compilation and VirtualMachine.start validation remain intact. */
export function runtimeBoundaryProgram(program,expected) {
  assert.equal(program.valid,false,'The compiler must reject this source');
  assert.deepEqual(program.diagnostics.map(({code,source,line,message})=>({code,source,line,message})),expected);
  assert.ok(program.diagnostics.every(d=>d.severity==='error'&&d.number===1002));
  return {...program,valid:true};
}
