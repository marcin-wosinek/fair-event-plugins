/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Button, Card, CardBody, CardHeader } from '@wordpress/components';
import { dateI18n, getSettings } from '@wordpress/date';

/**
 * Format a history timestamp in the site's timezone and date format.
 *
 * `created_at` is written by the database in UTC; marking it as such keeps
 * `dateI18n` from reading it as browser-local time.
 *
 * @param {string} createdAt 'YYYY-MM-DD HH:MM:SS' in UTC.
 * @return {string} Formatted date, or a dash when missing.
 */
function formatSentAt( createdAt ) {
	if ( ! createdAt ) {
		return '—';
	}
	const { formats } = getSettings();
	return dateI18n( formats.datetime, `${ createdAt.replace( ' ', 'T' ) }Z` );
}

/**
 * Who a recorded message was addressed to.
 *
 * @param {Object} mail History record.
 * @return {string} Event title or a fallback.
 */
function audienceOf( mail ) {
	if ( ! mail.event_date_id && ! mail.event_id ) {
		return __( 'All audience', 'fair-audience' );
	}
	return mail.event_title || __( '(deleted event)', 'fair-audience' );
}

/**
 * Messages sent so far, with reuse and removal of a record.
 *
 * @param {Object}   props             Component props.
 * @param {Array}    props.mails       History records.
 * @param {Function} props.onDuplicate Called with a record to reuse.
 * @param {Function} props.onDelete    Called with a record to delete.
 * @param {boolean}  props.disabled    Whether actions are locked.
 * @return {JSX.Element} The history card.
 */
export default function MailHistory( {
	mails,
	onDuplicate,
	onDelete,
	disabled,
} ) {
	return (
		<Card>
			<CardHeader>
				<h2 className="fair-audience-custom-mail__card-title">
					{ __( 'Mail History', 'fair-audience' ) }
				</h2>
			</CardHeader>
			<CardBody>
				{ mails.length === 0 ? (
					<p className="fair-audience-custom-mail__help">
						{ __( 'No messages sent yet.', 'fair-audience' ) }
					</p>
				) : (
					<table className="widefat striped fair-audience-custom-mail__table">
						<thead>
							<tr>
								<th scope="col">
									{ __( 'Subject', 'fair-audience' ) }
								</th>
								<th scope="col">
									{ __( 'Sent to', 'fair-audience' ) }
								</th>
								<th scope="col">
									{ __( 'Sent', 'fair-audience' ) }
								</th>
								<th scope="col">
									{ __( 'Failed', 'fair-audience' ) }
								</th>
								<th scope="col">
									{ __( 'Skipped', 'fair-audience' ) }
								</th>
								<th scope="col">
									{ __( 'Date', 'fair-audience' ) }
								</th>
								<th scope="col">
									{ __( 'Actions', 'fair-audience' ) }
								</th>
							</tr>
						</thead>
						<tbody>
							{ mails.map( ( mail ) => (
								<tr key={ mail.id }>
									<td
										data-label={ __(
											'Subject',
											'fair-audience'
										) }
									>
										{ mail.subject ||
											__(
												'(no subject)',
												'fair-audience'
											) }
									</td>
									<td
										data-label={ __(
											'Sent to',
											'fair-audience'
										) }
									>
										{ audienceOf( mail ) }
									</td>
									<td
										data-label={ __(
											'Sent',
											'fair-audience'
										) }
									>
										{ mail.sent_count }
									</td>
									<td
										data-label={ __(
											'Failed',
											'fair-audience'
										) }
									>
										{ mail.failed_count }
									</td>
									<td
										data-label={ __(
											'Skipped',
											'fair-audience'
										) }
									>
										{ mail.skipped_count }
									</td>
									<td
										data-label={ __(
											'Date',
											'fair-audience'
										) }
									>
										{ formatSentAt( mail.created_at ) }
									</td>
									<td
										data-label={ __(
											'Actions',
											'fair-audience'
										) }
									>
										<div className="fair-audience-custom-mail__actions">
											<Button
												variant="secondary"
												size="small"
												onClick={ () =>
													onDuplicate( mail )
												}
												disabled={ disabled }
											>
												{ __(
													'Duplicate',
													'fair-audience'
												) }
											</Button>
											<Button
												variant="secondary"
												isDestructive
												size="small"
												onClick={ () =>
													onDelete( mail )
												}
												disabled={ disabled }
											>
												{ __(
													'Delete',
													'fair-audience'
												) }
											</Button>
										</div>
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
				) }
			</CardBody>
		</Card>
	);
}
