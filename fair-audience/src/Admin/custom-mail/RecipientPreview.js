/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Notice, Spinner } from '@wordpress/components';

/**
 * Whether the server would deliver to this recipient at all.
 *
 * @param {Object} recipient Recipient row from the preview endpoint.
 * @return {boolean} True when the recipient has an address and consent.
 */
export function isEligible( recipient ) {
	return recipient.has_valid_email && ! recipient.would_skip_marketing;
}

/**
 * Display name of a recipient, never blank.
 *
 * @param {Object} recipient Recipient row.
 * @return {string} Name.
 */
function recipientName( recipient ) {
	const name = [ recipient.name, recipient.surname ]
		.filter( Boolean )
		.join( ' ' );
	return name || __( '(no name)', 'fair-audience' );
}

/**
 * How the participant relates to the event.
 *
 * @param {string} label Event-participant label.
 * @return {string} Translated label.
 */
function audienceLabel( label ) {
	switch ( label ) {
		case 'signed_up':
			return __( 'Participant', 'fair-audience' );
		case 'collaborator':
			return __( 'Collaborator', 'fair-audience' );
		case 'interested':
			return __( 'Interested', 'fair-audience' );
		default:
			return '—';
	}
}

/**
 * What will happen to a recipient when the email is sent.
 *
 * @param {Object}  recipient  Recipient row.
 * @param {boolean} isExcluded Whether the organizer excluded them.
 * @return {string} Translated status.
 */
function recipientStatus( recipient, isExcluded ) {
	if ( ! recipient.has_valid_email ) {
		return __( 'No valid email address', 'fair-audience' );
	}
	if ( recipient.would_skip_marketing ) {
		return __( 'No marketing consent', 'fair-audience' );
	}
	if ( isExcluded ) {
		return __( 'Excluded', 'fair-audience' );
	}
	return __( 'Will receive', 'fair-audience' );
}

/**
 * The list of people a send would reach, with per-person exclusion.
 *
 * @param {Object}   props             Component props.
 * @param {Object}   props.preview     Preview state: status, recipients, error.
 * @param {Set}      props.excludedIds Participant IDs the organizer excluded.
 * @param {Function} props.onToggle    Called with a participant ID to toggle.
 * @param {boolean}  props.disabled    Whether exclusions are locked.
 * @return {JSX.Element|null} The preview.
 */
export default function RecipientPreview( {
	preview,
	excludedIds,
	onToggle,
	disabled,
} ) {
	if ( preview.status === 'idle' ) {
		return null;
	}

	if ( preview.status === 'loading' ) {
		return (
			<div className="fair-audience-custom-mail__loading" role="status">
				<Spinner />
				<span>{ __( 'Loading recipients…', 'fair-audience' ) }</span>
			</div>
		);
	}

	if ( preview.status === 'error' ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ preview.error ||
					__(
						'The recipients could not be loaded.',
						'fair-audience'
					) }
			</Notice>
		);
	}

	const { recipients } = preview;

	if ( recipients.length === 0 ) {
		return (
			<p className="fair-audience-custom-mail__help">
				{ __( 'No one matches this selection.', 'fair-audience' ) }
			</p>
		);
	}

	const receiving = recipients.filter(
		( r ) => isEligible( r ) && ! excludedIds.has( r.participant_id )
	).length;
	const notReceiving = recipients.length - receiving;

	return (
		<div className="fair-audience-custom-mail__preview">
			<p>
				<strong>
					{ sprintf(
						/* translators: %d: number of people who will receive the email */
						_n(
							'%d person will receive this email.',
							'%d people will receive this email.',
							receiving,
							'fair-audience'
						),
						receiving
					) }
				</strong>{ ' ' }
				{ notReceiving > 0 &&
					sprintf(
						/* translators: %d: number of people who will not receive the email */
						_n(
							'%d person will not.',
							'%d people will not.',
							notReceiving,
							'fair-audience'
						),
						notReceiving
					) }
			</p>
			<table className="widefat striped fair-audience-custom-mail__table">
				<thead>
					<tr>
						<th scope="col">
							{ __( 'Exclude', 'fair-audience' ) }
						</th>
						<th scope="col">{ __( 'Name', 'fair-audience' ) }</th>
						<th scope="col">{ __( 'Email', 'fair-audience' ) }</th>
						<th scope="col">
							{ __( 'Audience', 'fair-audience' ) }
						</th>
						<th scope="col">{ __( 'Status', 'fair-audience' ) }</th>
					</tr>
				</thead>
				<tbody>
					{ recipients.map( ( r ) => {
						const eligible = isEligible( r );
						const isExcluded = excludedIds.has( r.participant_id );
						const name = recipientName( r );
						return (
							<tr
								key={ r.participant_id }
								className={
									! eligible || isExcluded
										? 'is-not-receiving'
										: undefined
								}
							>
								<td
									data-label={ __(
										'Exclude',
										'fair-audience'
									) }
								>
									<input
										type="checkbox"
										checked={ isExcluded }
										onChange={ () =>
											onToggle( r.participant_id )
										}
										disabled={ disabled || ! eligible }
										aria-label={ sprintf(
											/* translators: %s: participant name */
											__(
												'Do not send to %s',
												'fair-audience'
											),
											name
										) }
									/>
								</td>
								<td
									data-label={ __( 'Name', 'fair-audience' ) }
								>
									{ name }
								</td>
								<td
									data-label={ __(
										'Email',
										'fair-audience'
									) }
								>
									{ r.email || '—' }
								</td>
								<td
									data-label={ __(
										'Audience',
										'fair-audience'
									) }
								>
									{ audienceLabel( r.label ) }
								</td>
								<td
									data-label={ __(
										'Status',
										'fair-audience'
									) }
								>
									{ recipientStatus( r, isExcluded ) }
								</td>
							</tr>
						);
					} ) }
				</tbody>
			</table>
		</div>
	);
}
