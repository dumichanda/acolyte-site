# Decision register

`decision-register.json` is the source of truth: every product, design and technical decision (with UTC timestamp,
who made it, status, why and alternatives) and the effort estimate for each piece of work (person-days per specialist,
SA contractor rates). The published page is built by replacing `__DATA__` in `decision-register.template.html`
with the JSON. Add new decisions and tasks to the JSON as they are made.
