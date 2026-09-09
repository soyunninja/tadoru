# Architecture decision records

One file per significant decision. Each records what was decided, why, and what it costs.
They are append-only history: to reverse a decision, add a new record that supersedes the old
one rather than editing it. A future maintainer — human or agent — needs to know what was
already considered and rejected, not just what won.
