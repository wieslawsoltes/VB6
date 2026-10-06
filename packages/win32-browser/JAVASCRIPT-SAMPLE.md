# Independent JavaScript service example

No IDE or VB compiler is required:

```sh
node node_modules/@vb6/win32-browser/examples/run.mjs
```

Or import the sample from Node or a browser with package-name resolution:

```js
import {runCommonServicesSample} from '@vb6/win32-browser/examples/common-services';
console.log(await runCommonServicesSample());
```

The sample writes a private UTF-8 file, duplicates its handle, demonstrates a shared
cursor, converts text with size-query buffers, encodes Base64, waits cooperatively
for a JavaScript producer, and formats a GUID using owned task memory. Every run
creates and disposes its own compatibility instance, including on errors. The
packaging test extracts the actual npm archive and executes this example there;
concurrent repeat tests exercise isolation of its private file and named event.
Expected output includes `fileSize: 6`, `sharedPosition: 2`, `text: "Aé€"`,
`base64: "QcOp4oKs"`, and `yielded: true`. For plain browser imports without a
package resolver, use `./examples/common-services.mjs` relative to the extracted
package root served over HTTP. The six VB6 samples are listed in SERVICES.md.
