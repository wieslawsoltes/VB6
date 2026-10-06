# Native calendar intervals and formatting

The direct x86 exporter now implements DateAdd, DateDiff, DatePart and
FormatDateTime. These work in the classic IDE's Make EXE command, Node compiler,
standalone SDK and Blob Web Worker without rewriting the application source.
Named/optional arguments use the existing checked call binder and supplied values
are evaluated once in their written order.

## Implemented contract

The supported interval tokens are `yyyy`, `q`, `m`, `y`, `d`, `w`, `ww`, `h`, `n`
and `s`, matched case-insensitively over the complete String. Embedded NULs or
trailing characters are not silently accepted. DateAdd rounds its Double count
to the nearest whole number using ties-to-even, clamps an end-of-month result to
the destination month's last day, and checks the supported years 100..9999.
Large second/minute counts do not wrap through a 32-bit working register. Calendar
components use the existing Automation whole-second conversion policy, including
negative date serials around the 1899 epoch.

DateDiff returns a checked Long in this typed backend. Whole elapsed weeks (`w`)
and calendar week boundaries (`ww`) are distinct. Weekday/first-week options and
`vbUseSystem` are supported for the relevant week calculations; non-week units
ignore otherwise irrelevant week flags. DatePart returns Integer and uses the
Windows Automation calendar formatter after validating the token. FormatDateTime
returns an owned BSTR using VarFormatDateTime with named formats 0..4. Formatting
and system week defaults use the installed Windows user's NLS settings.

DateAdd/DateDiff arithmetic is readable, original private compiler-support code
lowered by the same JavaScript frontend and x86 emitter. Its isolated internal
scope cannot be redirected by user Public Year/CDate or similarly named functions.
Internal procedures do not appear as authored lines in the exported source map;
errors retain the caller's source context. No Script Host, CLR, VB6 runtime or
external compiler is invoked by generated applications.

## Independent reference qualifications

The Windows suite retains **both raw installed Script Host output and the chosen
language-contract reference**. Script Host truncates some fractional counts,
wraps some wide counts and rejects some valid year-100 formats. These differences
are not hidden or counted as exact raw-engine matches. The documented VBA nearest-
count policy is applied before reference calls; monotonic bounded substeps avoid
host count wrap without duplicating its calendar algorithm. A separate native API
probe supplies VarFormatDateTime results where Script Host has a narrower range.
Raw and adapted values, reasons, every application result and exit code are
retained. The current 2,328-case baseline contains 2,143 direct raw matches and
185 explicit policy/API distinctions; newly run reports remain authoritative.

A high decimal component plus a measured low-order residual preserves Double
transport precision through CStr. Date assertions retain the 1e-9-day tolerance;
the suite does not widen it to cover text transport loss. Independent hand-written
calendar invariants complement the reference driver. Native execution, source
compilation and browser byte equality are separate validation results.

This is Gregorian/user-locale support, not per-project LCID/DBCS or Hijri emulation,
full general Format syntax, Variant return storage or original VB6 certification.
No OS clock setters are added.

Primary references: [DateAdd](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/dateadd-function), [DateDiff](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/datediff-function), [DatePart](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/datepart-function), and [VarFormatDateTime](https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varformatdatetime).
