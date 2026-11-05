/**
 * Migration progress and controls.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	CheckboxControl,
	Notice,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import {
	blockerLabels,
	phaseLabels,
	verificationBlockerLabels,
} from './labels.js';
import { formatAmount, formatUtcDateTime } from './format.js';

const BACKUP_TABLES = [
	'fair_events_signups',
	'fair_events_tickets',
	'fair_events_ticket_activities',
	'fair_events_signup_payment_links',
	'fair_events_payment_history_findings',
	'fair_events_payment_history_comparisons',
];

/**
 * Where the migration stands, in one sentence an organizer understands.
 *
 * @param {Object} status Status from the API.
 * @return {{tone: string, text: string}} Summary.
 */
export function describeStage( status ) {
	const { dry_run: dryRun, backfill } = status;
	if ( backfill ) {
		switch ( backfill.status ) {
			case 'running':
				return {
					tone: 'info',
					text: __(
						'The migration is running in the background. You can leave this page; it continues on its own.',
						'fair-events'
					),
				};
			case 'paused':
				return {
					tone: 'warning',
					text: __(
						'The migration is paused until the problems below are fixed. It continues on its own once they are.',
						'fair-events'
					),
				};
			case 'verified':
				return {
					tone: 'success',
					text: __(
						'The migration finished and its verification passed. Old and new payment records agree, apart from the differences listed.',
						'fair-events'
					),
				};
			case 'verification_failed':
				return {
					tone: 'warning',
					text: __(
						'The migration finished, but its verification found problems. Fix them, then verify again.',
						'fair-events'
					),
				};
		}
	}
	if ( dryRun?.status === 'running' ) {
		return {
			tone: 'info',
			text: __(
				'The dry run is checking your records. It changes nothing.',
				'fair-events'
			),
		};
	}
	if ( dryRun?.status === 'complete' ) {
		return {
			tone: 'info',
			text: __(
				'The dry run finished. Review what it found below, then start the migration.',
				'fair-events'
			),
		};
	}
	return {
		tone: 'info',
		text: __(
			'Nothing has been migrated yet. Start with a dry run: it shows what the migration would do and changes nothing.',
			'fair-events'
		),
	};
}

/**
 * One run's progress: its step and what it counted so far.
 *
 * @param {Object} props
 * @param {string} props.title Run name.
 * @param {Object} props.run   Run state.
 * @return {JSX.Element} Progress.
 */
function RunProgress( { title, run } ) {
	const phases = phaseLabels();
	const counts = run.counts || {};
	const created =
		( counts.purchase_created || 0 ) +
		( counts.revisit_purchase_created || 0 );
	const planned = counts.purchase_planned || 0;
	const links =
		( counts.links_inserted || 0 ) + ( counts.links_planned || 0 );
	const findings = Object.values( run.findings || {} ).reduce(
		( sum, n ) => sum + n,
		0
	);

	return (
		<div className="fair-events-payment-history__run">
			<h3>{ title }</h3>
			<dl className="fair-events-payment-history__facts">
				<dt>{ __( 'Step', 'fair-events' ) }</dt>
				<dd>
					{ run.status === 'running'
						? ( phases[ run.phase ] ?? run.phase )
						: __( 'Finished', 'fair-events' ) }
				</dd>
				<dt>{ __( 'Started', 'fair-events' ) }</dt>
				<dd>{ formatUtcDateTime( run.started_at ) }</dd>
				{ run.completed_at && (
					<>
						<dt>{ __( 'Finished', 'fair-events' ) }</dt>
						<dd>{ formatUtcDateTime( run.completed_at ) }</dd>
					</>
				) }
				<dt>{ __( 'Registrations to migrate', 'fair-events' ) }</dt>
				<dd>{ created + planned }</dd>
				<dt>{ __( 'Payment links', 'fair-events' ) }</dt>
				<dd>{ links }</dd>
				<dt>{ __( 'Records to review', 'fair-events' ) }</dt>
				<dd>{ findings }</dd>
			</dl>
			{ Object.entries( run.totals || {} ).map( ( [ currency, t ] ) => (
				<p key={ currency }>
					{ sprintf(
						/* translators: 1: paid amount that can be attributed, 2: paid amount left for review */
						__(
							'Paid: %1$s can be linked automatically, %2$s needs review.',
							'fair-events'
						),
						formatAmount( t.attributed, currency ),
						formatAmount( t.unresolved, currency )
					) }
				</p>
			) ) }
			{ run.last_error && (
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: 1: error message, 2: date and time of the next attempt or the failure */
						__(
							'The last batch failed and will be retried automatically: %1$s (%2$s)',
							'fair-events'
						),
						run.last_error.message,
						formatUtcDateTime( run.last_error.at )
					) }
				</Notice>
			) }
		</div>
	);
}

/**
 * The migration card.
 *
 * @param {Object}   props
 * @param {Object}   props.status   Status from the API.
 * @param {Function} props.onAction Runs a control: (path, data) => Promise.
 * @return {JSX.Element} Card.
 */
export default function MigrationPanel( { status, onAction } ) {
	const [ pending, setPending ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ confirming, setConfirming ] = useState( false );
	const [ backupConfirmed, setBackupConfirmed ] = useState( false );
	const busy = useRef( false );

	const blockers = status.blockers || [];
	const dryRun = status.dry_run;
	const backfill = status.backfill;
	const running =
		dryRun?.status === 'running' ||
		[ 'running', 'paused' ].includes( backfill?.status );
	const stage = describeStage( status );
	const verificationBlockers = backfill?.verification?.blockers || {};

	const run = async ( key, path, data = {} ) => {
		if ( busy.current ) {
			return false;
		}
		busy.current = true;
		setPending( key );
		setError( null );
		try {
			await onAction( path, data );
			return true;
		} catch ( e ) {
			setError(
				e?.message ||
					__(
						'The request failed. Check your connection and try again.',
						'fair-events'
					)
			);
			return false;
		} finally {
			busy.current = false;
			setPending( null );
		}
	};

	const startDisabledReason = ( () => {
		if ( blockers.length ) {
			return __(
				'The migration can’t start until the problems above are fixed.',
				'fair-events'
			);
		}
		if ( dryRun?.status !== 'complete' ) {
			return __(
				'Run a dry run and review it before starting the migration.',
				'fair-events'
			);
		}
		if (
			JSON.stringify( dryRun.cutoffs ) !==
			JSON.stringify( status.cutoffs )
		) {
			return __(
				'New records arrived since the dry run. Run it again before starting.',
				'fair-events'
			);
		}
		return null;
	} )();

	return (
		<Card className="fair-events-payment-history__card">
			<CardHeader>
				<h2>{ __( 'Migration', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					<Notice status={ stage.tone } isDismissible={ false }>
						{ stage.text }
					</Notice>

					{ blockers.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							<p>
								{ __(
									'The migration can’t run on this site yet:',
									'fair-events'
								) }
							</p>
							<ul className="fair-events-payment-history__list">
								{ blockers.map( ( code ) => (
									<li key={ code }>
										{ blockerLabels()[ code ] ?? code }
									</li>
								) ) }
							</ul>
						</Notice>
					) }

					{ Object.keys( verificationBlockers ).length > 0 &&
						backfill?.status === 'verification_failed' && (
							<Notice status="warning" isDismissible={ false }>
								<ul className="fair-events-payment-history__list">
									{ Object.keys( verificationBlockers ).map(
										( code ) => (
											<li key={ code }>
												{ verificationBlockerLabels()[
													code
												] ?? code }
											</li>
										)
									) }
								</ul>
							</Notice>
						) }

					<div className="fair-events-payment-history__runs">
						{ dryRun && (
							<RunProgress
								title={ __( 'Dry run', 'fair-events' ) }
								run={ dryRun }
							/>
						) }
						{ backfill && (
							<RunProgress
								title={ __( 'Migration', 'fair-events' ) }
								run={ backfill }
							/>
						) }
					</div>

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }

					<HStack justify="flex-start" spacing={ 3 } wrap>
						{ ! backfill && (
							<Button
								variant={
									dryRun?.status === 'complete'
										? 'secondary'
										: 'primary'
								}
								onClick={ () => run( 'dry-run', '/dry-run' ) }
								isBusy={ pending === 'dry-run' }
								disabled={
									!! pending || running || blockers.length > 0
								}
								accessibleWhenDisabled
							>
								{ dryRun
									? __(
											'Run the dry run again',
											'fair-events'
										)
									: __( 'Run a dry run', 'fair-events' ) }
							</Button>
						) }
						{ ! backfill && (
							<Button
								variant="primary"
								onClick={ () => setConfirming( true ) }
								disabled={
									!! pending ||
									running ||
									!! startDisabledReason
								}
								accessibleWhenDisabled
							>
								{ __( 'Start the migration', 'fair-events' ) }
							</Button>
						) }
						{ backfill?.status === 'paused' && (
							<Button
								variant="primary"
								onClick={ () =>
									run( 'resume', '/backfill/resume' )
								}
								isBusy={ pending === 'resume' }
								disabled={ !! pending || blockers.length > 0 }
								accessibleWhenDisabled
							>
								{ __(
									'Continue the migration',
									'fair-events'
								) }
							</Button>
						) }
						{ [ 'verified', 'verification_failed' ].includes(
							backfill?.status
						) && (
							<Button
								variant="secondary"
								onClick={ () => run( 'verify', '/verify' ) }
								isBusy={ pending === 'verify' }
								disabled={ !! pending }
							>
								{ __( 'Verify again', 'fair-events' ) }
							</Button>
						) }
					</HStack>
					{ ! backfill && ! running && startDisabledReason && (
						<p className="fair-events-payment-history__hint">
							{ startDisabledReason }
						</p>
					) }
				</VStack>
			</CardBody>

			{ confirming && (
				<ConfirmActionModal
					title={ __(
						'Start the payment history migration',
						'fair-events'
					) }
					confirmLabel={ __( 'Start the migration', 'fair-events' ) }
					busyLabel={ __( 'Starting…', 'fair-events' ) }
					isBusy={ pending === 'start' }
					confirmDisabled={ ! backupConfirmed }
					error={ error }
					onCancel={ () => {
						setConfirming( false );
						setError( null );
						setBackupConfirmed( false );
					} }
					onConfirm={ async () => {
						const started = await run( 'start', '/backfill', {
							backup_confirmed: true,
						} );
						if ( started ) {
							setConfirming( false );
							setBackupConfirmed( false );
						}
					} }
				>
					<p>
						{ sprintf(
							/* translators: %d: number of registrations the dry run would migrate */
							_n(
								'The migration creates Fair Events purchases for %d historical registration and links past payments to purchases, as the dry run showed.',
								'The migration creates Fair Events purchases for %d historical registrations and links past payments to purchases, as the dry run showed.',
								dryRun?.counts?.purchase_planned || 0,
								'fair-events'
							),
							dryRun?.counts?.purchase_planned || 0
						) }
					</p>
					<p>
						{ __(
							'It doesn’t change or delete any existing registration, payment or refund record, doesn’t charge or refund anyone, and sends no email. Ticket counts and statistics stay the same.',
							'fair-events'
						) }
					</p>
					<p>
						{ __(
							'It can’t be undone from this page. To undo it, restore a database backup of these tables:',
							'fair-events'
						) }
					</p>
					<ul className="fair-events-payment-history__tables">
						{ BACKUP_TABLES.map( ( table ) => (
							<li key={ table }>
								<code>{ table }</code>
							</li>
						) ) }
					</ul>
					<CheckboxControl
						__nextHasNoMarginBottom
						label={ __(
							'I took a database backup that includes these tables.',
							'fair-events'
						) }
						checked={ backupConfirmed }
						onChange={ setBackupConfirmed }
						disabled={ pending === 'start' }
					/>
				</ConfirmActionModal>
			) }
		</Card>
	);
}
