# Fair Membership - TODO

## Block Compatibility Issues

### Support fillout script inside the conditional blocks
The fillout form embed script doesn't execute properly when placed inside membership-switch conditional blocks (member-content / non-member-content). The blocks may be interfering with script enqueuing or execution for nested dynamic content.

**Affected blocks:**
- fair-membership/membership-switch
- fair-membership/member-content
- fair-membership/non-member-content

**Expected behavior:** Fillout forms should work the same inside conditional blocks as they do on regular pages.

### Support rsvp-button block inside conditional blocks
The fair-rsvp RSVP button block doesn't render correctly when nested inside membership conditional blocks. The `<form>` tag is missing from the rendered HTML, causing the JavaScript to fail to initialize.

**Affected blocks:**
- fair-rsvp/rsvp-button (when nested in membership-switch)

**Expected behavior:** RSVP button should render with full HTML structure including the `<form>` element when placed inside member-content or non-member-content blocks.

**Related:** This may be a general issue with how InnerBlocks handles dynamic block rendering. Other dynamic blocks with viewScript may be affected.
