import {messagePortTransport} from './rpc.js';
import {BuiltinLanguageServer} from './builtin-server.js';
new BuiltinLanguageServer(messagePortTransport(globalThis));
