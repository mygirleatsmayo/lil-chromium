# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in the mayo skills | Label in our tracker | Meaning                                  |
| ------------------------ | -------------------- | ---------------------------------------- |
| `needs-triage`           | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`             | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`        | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`        | `ready-for-human`    | Requires human implementation            |
| `wontfix`                | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Capability labels

Beyond the triage roles, tickets may carry capability marks (applied by `mayosdd-to-tickets`, consumed at dispatch when choosing a worker):

| Label               | Meaning                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `high-context`      | Needs a worker with a large usable context window (deliberately fat slice) |
| `high-intelligence` | Needs a worker with exceptional reasoning                                 |

They are independent signals — a thin ticket can carry `high-intelligence` alone.
