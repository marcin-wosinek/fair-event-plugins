## Shared Package: fair-events-shared

Private workspace package of shared JS utilities used across the Fair Event
plugins. To consume: add
`"fair-events-shared": "*"` to the plugin's `dependencies`, export the utility
from `fair-events-shared/src/index.js`, and import it
`from 'fair-events-shared'`. Uses ES modules; tested with Jest + Babel.
