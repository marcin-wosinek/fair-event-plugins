/**
 * Switching payment records to Fair Events: the stage 4 activation, its
 * blockers, and what needs repair after it (PAYMENT_HISTORY_MIGRATION.md
 * §8.13).
 *
 * @package FairEvents
 */

import { __, sprintf } from '@wordpress/i18n';
import { Fragment, useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	CheckboxControl,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import {
	cutoverBlockerLabels,
	cutoverIssueLabels,
	workKindLabels,
} from './labels.js';
import { formatUtcDateTime } from './format.js';

export const CUTOVER_BACKUP_TABLES = [
	'fair_events_signups',
	'fair_events_tickets',
	'fair_events_ticket_activities',
	'fair_events_signup_payment_links',
	'fair_events_payment_shadow_work',
	'fair_events_payment_history_findings',
	'fair_events_payment_history_audit',
	'fair_audience_event_participants',
	'fair_audience_event_participant_options',
	'fair_audience_event_participant_transactions',
	'fair_payment_transactions',
];

/**
 * Queued work per kind, all statuses together.
 *
 * @param {Object} work Counts by kind, then status.
 * @return {Array<[string, number]>} Kinds with work, in label order.
 */
export function workTotals( work ) {
	return Object.keys( workKindLabels() )
		.map( ( kind ) => [
			kind,
			Object.values( work?.[ kind ] || {} ).reduce(
				( sum, n ) => sum + n,
				0
			),
		] )
		.filter( ( [ , total ] ) => total > 0 );
}

/**
 * The switch card.
 *
 * @param {Object}   props
 * @param {Object}   props.cutover  Cutover state from the API (`status.cutover`).
 * @param {Function} props.onAction Runs a control: (path, data) => Promise.
 * @return {JSX.Element} Card.
 */
export default function CutoverPanel( { cutover, onAction } ) {
	const [ confirming, setConfirming ] = useState( false );
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ backupConfirmed, setBackupConfirmed ] = useState( false );
	const busy = useRef( false );

	const activation = cutover.activation;
	const blockers = cutover.blockers || [];
	const issues = cutover.issues || [];
	const work = workTotals( cutover.work );
	const kinds = workKindLabels();

	const close = () => {
		setConfirming( false );
		setError( null );
		setBackupConfirmed( false );
	};

	const activate = async () => {
		if ( busy.current ) {
			return;
		}
		busy.current = true;
		setPending( true );
		setError( null );
		try {
			await onAction( '/cutover', { backup_confirmed: true } );
			close();
		} catch ( e ) {
			setError(
				e?.message ||
					__(
						'The request failed. Check your connection and try again.',
						'fair-events'
					)
			);
		} finally {
			busy.current = false;
			setPending( false );
		}
	};

	return (
		<Card className="fair-events-payment-history__card">
			<CardHeader>
				<h2>{ __( 'Payment records', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					{ activation ? (
						<Notice status="success" isDismissible={ false }>
							{ activation.user_name
								? sprintf(
										/* translators: 1: date and time of the switch, 2: administrator's name */
										__(
											'Payment records use Fair Events since %1$s. Switched by %2$s.',
											'fair-events'
										),
										formatUtcDateTime(
											activation.activated_at
										),
										activation.user_name
									)
								: sprintf(
										/* translators: %s: date and time of the switch */
										__(
											'Payment records use Fair Events since %s.',
											'fair-events'
										),
										formatUtcDateTime(
											activation.activated_at
										)
									) }
						</Notice>
					) : (
						<p className="fair-events-payment-history__intro">
							{ __(
								'Fair Audience’s records still decide which purchases are paid. After the switch, Fair Events does: each new payment is linked to its purchases before the buyer pays, a late payment for an earlier attempt still confirms its purchase, and a repeated payment notification counts once.',
								'fair-events'
							) }
						</p>
					) }

					{ issues.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							<ul className="fair-events-payment-history__list">
								{ issues.map( ( code ) => (
									<li key={ code }>
										{ cutoverIssueLabels()[ code ] ?? code }
									</li>
								) ) }
							</ul>
						</Notice>
					) }

					{ ! activation && blockers.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							<p>
								{ __(
									'Payment records can’t switch to Fair Events yet:',
									'fair-events'
								) }
							</p>
							<ul className="fair-events-payment-history__list">
								{ blockers.map( ( code ) => (
									<li key={ code }>
										{ cutoverBlockerLabels()[ code ] ??
											code }
									</li>
								) ) }
							</ul>
						</Notice>
					) }

					{ work.length > 0 && (
						<div>
							<h3>
								{ __( 'Waiting to be retried', 'fair-events' ) }
							</h3>
							<dl className="fair-events-payment-history__facts">
								{ work.map( ( [ kind, total ] ) => (
									<Fragment key={ kind }>
										<dt>{ kinds[ kind ] }</dt>
										<dd>{ total }</dd>
									</Fragment>
								) ) }
							</dl>
							<p className="fair-events-payment-history__hint">
								{ __(
									'These are retried automatically every fifteen minutes. Nothing is charged twice.',
									'fair-events'
								) }
							</p>
						</div>
					) }

					{ activation ? (
						<p className="fair-events-payment-history__hint">
							{ __(
								'The switch can’t be undone. If something goes wrong, update the plugins and fix the records here; Fair Audience’s records stay as they were.',
								'fair-events'
							) }
						</p>
					) : (
						<div>
							<Button
								variant="primary"
								onClick={ () => setConfirming( true ) }
								disabled={ blockers.length > 0 }
								accessibleWhenDisabled
							>
								{ __(
									'Switch payment records to Fair Events',
									'fair-events'
								) }
							</Button>
						</div>
					) }
				</VStack>
			</CardBody>

			{ confirming && (
				<ConfirmActionModal
					title={ __(
						'Switch payment records to Fair Events',
						'fair-events'
					) }
					confirmLabel={ __(
						'Switch payment records',
						'fair-events'
					) }
					busyLabel={ __( 'Switching…', 'fair-events' ) }
					isBusy={ pending }
					confirmDisabled={ ! backupConfirmed }
					error={ error }
					onCancel={ close }
					onConfirm={ activate }
				>
					<p>
						{ __(
							'From now on Fair Events decides which purchases are paid, for tickets and for Fair Audience registrations, activities and series upgrades.',
							'fair-events'
						) }
					</p>
					<p>
						{ __(
							'It doesn’t charge, refund or email anyone. Ticket counts and statistics stay the same, and Fair Audience’s own records are still kept up to date.',
							'fair-events'
						) }
					</p>
					<p>
						{ __(
							'It can’t be undone. Restoring a backup afterwards loses the payments recorded since, so take a fresh database backup of these tables first:',
							'fair-events'
						) }
					</p>
					<ul className="fair-events-payment-history__tables">
						{ CUTOVER_BACKUP_TABLES.map( ( table ) => (
							<li key={ table }>
								<code>{ table }</code>
							</li>
						) ) }
					</ul>
					<CheckboxControl
						__nextHasNoMarginBottom
						label={ __(
							'I took a fresh database backup that includes these tables.',
							'fair-events'
						) }
						checked={ backupConfirmed }
						onChange={ setBackupConfirmed }
						disabled={ pending }
					/>
				</ConfirmActionModal>
			) }
		</Card>
	);
}
