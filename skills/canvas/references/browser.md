# Browser document capability

For an existing structured artifact, use the [structured document](structured-document.md)
reference. For an ordinary portable browser artifact, write a self-contained HTML file in
the task's authorized output directory and provide its actual path.
Do not change an application stack or publish a website merely to display an analysis.

Use platform HTML, CSS, SVG and JavaScript with embedded bounded data. The artifact should open
offline without a package installation, remote script, font service, analytics or network fetch.
If live data is part of the requested product, keep its existing authentication and data owner;
label any exported snapshot with its observation time.

Insert source strings as text, not executable HTML. Validate numeric controls, display invalid
inputs explicitly and keep calculations deterministic. State currency and periods together;
do not combine recurring and one-time costs into an unlabeled total.

Use the available browser to open the actual file or its existing preview. Verify a narrow
mobile viewport and a wide viewport, keyboard navigation, changed inputs and error handling.
For a claimed offline result, reload with network disabled when the host supports it. If only
source inspection was possible, report offline/render behavior as unverified.

Save through the user's existing artifact workflow. Browser preview does not authorize deployment,
payment, publication, downloading customer data or creating an additional service.
