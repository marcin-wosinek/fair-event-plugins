import { __, sprintf } from '@wordpress/i18n';
import { formatDate } from '../utils/format-date.js';

/**
 * Human-readable identity of a submission, with fallbacks for anonymous
 * respondents and missing form/date values. The ID is always included so
 * repeated submissions with the same respondent and timestamp stay distinct.
 *
 * @param {Object} submission Submission row from the questionnaire-responses API.
 * @return {{respondent: string, form: string, date: string, id: string}} Display values.
 */
export function describeSubmission( submission ) {
	return {
		respondent:
			submission.participant_name ||
			submission.participant_email ||
			__( 'Anonymous respondent', 'fair-form' ),
		form: submission.form_title || __( 'Untitled form', 'fair-form' ),
		date:
			formatDate( submission.created_at ) ||
			__( 'Unknown date', 'fair-form' ),
		id: sprintf(
			/* translators: %d: submission ID */
			__( '#%d', 'fair-form' ),
			submission.id
		),
	};
}

/**
 * Identifies the submission a dialog acts on.
 *
 * @param {Object} props            Component props.
 * @param {Object} props.submission Submission row.
 * @return {Element} Description list.
 */
export default function SubmissionContext( { submission } ) {
	const { respondent, form, date, id } = describeSubmission( submission );
	const rows = [
		[ __( 'Respondent', 'fair-form' ), respondent ],
		[ __( 'Form', 'fair-form' ), form ],
		[ __( 'Submitted', 'fair-form' ), date ],
		[ __( 'Submission ID', 'fair-form' ), id ],
	];

	return (
		<dl
			className="fair-form-submission-context"
			style={ {
				display: 'grid',
				gridTemplateColumns: 'max-content minmax(0, 1fr)',
				gap: '4px 16px',
				margin: '0 0 16px',
			} }
		>
			{ rows.map( ( [ label, value ] ) => (
				<div key={ label } style={ { display: 'contents' } }>
					<dt style={ { fontWeight: 600 } }>{ label }</dt>
					<dd style={ { margin: 0, overflowWrap: 'anywhere' } }>
						{ value }
					</dd>
				</div>
			) ) }
		</dl>
	);
}
