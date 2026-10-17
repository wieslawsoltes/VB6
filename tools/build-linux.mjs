/** Repository entry point for the independent Linux executable exporter. */
import {main} from '../packages/linux-native/bin/vb6-linux.mjs';
try {await main();}catch(error){console.error(error.message);if(error.diagnostics)console.error(JSON.stringify(error.diagnostics,null,2));process.exitCode=1;}
