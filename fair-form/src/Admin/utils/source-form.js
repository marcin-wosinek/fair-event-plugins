import { __ } from '@wordpress/i18n';

// Display name of the form a submission came from: the stored form title,
// then the form identifier, then the "legacy" wording the by-Form grouping
// uses for submissions that predate form identifiers.
export function sourceFormLabel( submission ) {
	return (
		submission.source_form_title ||
		submission.form_id ||
		__( 'Legacy (no form id)', 'fair-form' )
	);
}
