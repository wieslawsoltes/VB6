import {runCommonServicesSample} from './common-services.mjs';
try {
  console.log(JSON.stringify(await runCommonServicesSample(),null,2));
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}
