/**
 * Upgrade readiness after the payment history migration
 * (PAYMENT_HISTORY_MIGRATION.md §8.17): whether this site is safe to run
 * releases without the migration, what is still missing, the removal of
 * the old records (§8.21), and the operator's staging verification.
 *
 * @package FairEvents
 */

import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	CheckboxControl,
	Notice,
	Spinner,
	TextControl,
	TextareaControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import {
	cleanupBlockerLabels,
	stagingCheckLabels,
	upgradeCheckLabels,
} from './labels.js';
import { formatUtcDateTime } from './format.js';
import ConfirmActionModal from '../components/ConfirmActionModal.js';

const PATH = '/fair-events/v1/payment-history/upgrade';

/**
 * What the cleanup removes (PaymentHistoryCleanup::TABLES and ::OPTIONS),
 * without the table prefix.
 */
export const CLEANUP_TABLES = [
	'fair_audience_event_participant_transactions',
	'fair_events_payment_history_comparisons',
];
export const CLEANUP_OPTIONS = [
	'fair_events_payment_history_migration',
	'fair_events_payment_history_cutover',
	'fair_events_payment_history_readers',
];

/**
 * What a backup taken before the cleanup must include.
 */
export const CLEANUP_BACKUP_TABLES = [
	...CLEANUP_TABLES,
	'fair_events_payment_history_findings',
	'fair_events_payment_history_audit',
	'options',
];

const PLUGIN_NAMES = {
	'fair-payments-connector': 'Fair Payments Connector',
	'fair-events': 'Fair Events',
	'fair-audience': 'Fair Audience',
};

/**
 * Form values from a recorded staging verification, or today's defaults.
 *
 * @param {Object} status Upgrade status from the API.
 * @return {Object} verified_on, versions, checks, note.
 */
export function formFromStatus( status ) {
	const staging = status.staging_verification;
	const versions = {};
	Object.keys( PLUGIN_NAMES ).forEach( ( slug ) => {
		versions[ slug ] =
			staging?.versions?.[ slug ] ??
			status.plugin_versions?.[ slug ] ??
			'';
	} );
	const checks = {};
	Object.keys( stagingCheckLabels() ).forEach( ( code ) => {
		checks[ code ] = !! staging?.checks?.[ code ];
	} );
	return {
		verified_on: staging?.verified_on ?? '',
		versions,
		checks,
		note: staging?.note ?? '',
	};
}

/**
 * The sentence describing recorded evidence.
 *
 * @param {Object} evidence Completion evidence.
 * @return {string} Text.
 */
function evidenceText( evidence ) {
	const when = formatUtcDateTime( evidence.recorded_at );
	if ( evidence.basis === 'fresh_install' ) {
		return sprintf(
			/* translators: %s: date and time */
			__(
				'Safe to upgrade. Fair Events was installed here without earlier payment history (recorded %s), so there is nothing to migrate.',
				'fair-events'
			),
			when
		);
	}
	if ( evidence.basis === 'no_source_history' ) {
		return sprintf(
			/* translators: %s: date and time */
			__(
				'Safe to upgrade. This site had no earlier Fair Audience records to move (recorded %s).',
				'fair-events'
			),
			when
		);
	}
	return sprintf(
		/* translators: %s: date and time */
		__(
			'Safe to upgrade. The migration finished and was recorded on %s.',
			'fair-events'
		),
		when
	);
}

/**
 * The upgrade readiness card.
 *
 * @param {Object} props
 * @param {number} props.refreshKey Changes when the migration changed.
 * @return {JSX.Element} Card.
 */
export default function UpgradePanel( { refreshKey = 0 } ) {
	const [ status, setStatus ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ form, setForm ] = useState( null );
	const [ dirty, setDirty ] = useState( false );
	const [ saving, setSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	const [ saved, setSaved ] = useState( false );
	const busy = useRef( false );
	const dirtyRef = useRef( false );
	const [ confirming, setConfirming ] = useState( false );
	const [ backupConfirmed, setBackupConfirmed ] = useState( false );
	const [ cleaning, setCleaning ] = useState( false );
	const [ cleanupError, setCleanupError ] = useState( null );
	const [ cleanedUp, setCleanedUp ] = useState( false );
	const cleanupBusy = useRef( false );

	const load = useCallback(
		() =>
			apiFetch( { path: PATH } )
				.then( ( data ) => {
					setStatus( data );
					setLoadError( null );
					if ( ! dirtyRef.current ) {
						setForm( formFromStatus( data ) );
					}
				} )
				.catch( ( e ) =>
					setLoadError(
						e?.message ||
							__(
								'The upgrade readiness couldn’t be loaded.',
								'fair-events'
							)
					)
				),
		[]
	);

	useEffect( () => {
		load();
	}, [ load, refreshKey ] );

	useEffect( () => {
		dirtyRef.current = dirty;
		if ( ! dirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ dirty ] );

	const change = ( next ) => {
		setForm( ( current ) => ( { ...current, ...next } ) );
		setDirty( true );
		setSaved( false );
	};

	const save = async () => {
		if ( busy.current ) {
			return;
		}
		busy.current = true;
		setSaving( true );
		setSaveError( null );
		try {
			const data = await apiFetch( {
				path: `${ PATH }/staging-verification`,
				method: 'PUT',
				data: form,
			} );
			setStatus( data );
			setForm( formFromStatus( data ) );
			setDirty( false );
			setSaved( true );
		} catch ( e ) {
			setSaveError(
				e?.message ||
					__(
						'The staging verification couldn’t be saved. Check your connection and try again.',
						'fair-events'
					)
			);
		} finally {
			busy.current = false;
			setSaving( false );
		}
	};

	const closeCleanup = () => {
		setConfirming( false );
		setBackupConfirmed( false );
		setCleanupError( null );
	};

	const runCleanup = async () => {
		if ( cleanupBusy.current ) {
			return;
		}
		cleanupBusy.current = true;
		setCleaning( true );
		setCleanupError( null );
		try {
			const data = await apiFetch( {
				path: `${ PATH }/cleanup`,
				method: 'POST',
				data: { backup_confirmed: true },
			} );
			setStatus( data );
			setCleanedUp( true );
			closeCleanup();
		} catch ( e ) {
			setCleanupError(
				e?.message ||
					__(
						'The old payment records couldn’t be removed. Check your connection and try again.',
						'fair-events'
					)
			);
		} finally {
			cleanupBusy.current = false;
			setCleaning( false );
		}
	};

	if ( loadError ) {
		return (
			<Notice status="error" isDismissible={ false }>
				<p>{ loadError }</p>
				<Button variant="secondary" onClick={ load }>
					{ __( 'Try again', 'fair-events' ) }
				</Button>
			</Notice>
		);
	}
	if ( ! status || ! form ) {
		return <Spinner />;
	}

	const checkLabels = upgradeCheckLabels();
	const stagingLabels = stagingCheckLabels();
	const cleanupLabels = cleanupBlockerLabels();
	const cleanup = status.ready_for_cleanup;
	const staging = status.staging_verification;
	const release = status.intermediate_release;
	const missingDate = ! form.verified_on;
	const missingEventsVersion = ! form.versions[ 'fair-events' ]?.trim();

	return (
		<Card className="fair-events-payment-history__card">
			<CardHeader>
				<h2>{ __( 'Upgrade readiness', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					{ status.safe_to_upgrade ? (
						<Notice status="success" isDismissible={ false }>
							{ evidenceText( status.evidence ) }
						</Notice>
					) : (
						<Notice status="warning" isDismissible={ false }>
							<p>
								{ sprintf(
									/* translators: %s: release name, e.g. build-2.2.0 */
									__(
										'Not safe to upgrade yet. Later releases no longer include the migration: finish it here, on %s, before updating.',
										'fair-events'
									),
									release.tag
								) }
							</p>
						</Notice>
					) }

					<ul className="fair-events-payment-history__checklist">
						{ Object.entries( status.checks ).map(
							( [ code, met ] ) => (
								<li key={ code }>
									<strong>
										{ met
											? sprintf(
													/* translators: %s: condition, e.g. "Migration verified" */
													__(
														'Done: %s',
														'fair-events'
													),
													checkLabels[ code ]
														?.label ?? code
												)
											: sprintf(
													/* translators: %s: condition, e.g. "Migration verified" */
													__(
														'Not yet: %s',
														'fair-events'
													),
													checkLabels[ code ]
														?.label ?? code
												) }
									</strong>
									{ ! met && checkLabels[ code ] && (
										<span className="fair-events-payment-history__hint">
											{ ' ' }
											{ checkLabels[ code ].action }
										</span>
									) }
								</li>
							)
						) }
					</ul>

					<div>
						<h3>{ __( 'Removing old records', 'fair-events' ) }</h3>
						<CleanupSection
							cleanup={ cleanup }
							labels={ cleanupLabels }
							justDone={ cleanedUp }
							onStart={ () => setConfirming( true ) }
						/>
					</div>

					{ cleanup.applicable && (
						<div>
							<h3>
								{ __( 'Staging verification', 'fair-events' ) }
							</h3>
							<p className="fair-events-payment-history__hint">
								{ __(
									'Record the final checks you ran on a staging copy of this site, and the plugin versions it ran.',
									'fair-events'
								) }
							</p>
							{ staging && (
								<p className="fair-events-payment-history__hint">
									{ staging.user_name
										? sprintf(
												/* translators: 1: date and time, 2: administrator's name */
												__(
													'Last recorded on %1$s by %2$s.',
													'fair-events'
												),
												formatUtcDateTime(
													staging.recorded_at
												),
												staging.user_name
											)
										: sprintf(
												/* translators: %s: date and time */
												__(
													'Last recorded on %s.',
													'fair-events'
												),
												formatUtcDateTime(
													staging.recorded_at
												)
											) }
								</p>
							) }
							<VStack spacing={ 3 }>
								<TextControl
									__next40pxDefaultSize
									__nextHasNoMarginBottom
									type="date"
									label={ __(
										'Verified on (staging)',
										'fair-events'
									) }
									value={ form.verified_on }
									onChange={ ( value ) =>
										change( { verified_on: value } )
									}
								/>
								<div className="fair-events-payment-history__filters">
									{ Object.entries( PLUGIN_NAMES ).map(
										( [ slug, name ] ) => (
											<TextControl
												key={ slug }
												__next40pxDefaultSize
												__nextHasNoMarginBottom
												label={ sprintf(
													/* translators: %s: plugin name */
													__(
														'%s version',
														'fair-events'
													),
													name
												) }
												value={ form.versions[ slug ] }
												onChange={ ( value ) =>
													change( {
														versions: {
															...form.versions,
															[ slug ]: value,
														},
													} )
												}
											/>
										)
									) }
								</div>
								{ Object.entries( stagingLabels ).map(
									( [ code, { label, help } ] ) => (
										<CheckboxControl
											key={ code }
											__nextHasNoMarginBottom
											label={ label }
											help={ help }
											checked={ form.checks[ code ] }
											onChange={ ( checked ) =>
												change( {
													checks: {
														...form.checks,
														[ code ]: checked,
													},
												} )
											}
										/>
									)
								) }
								<TextareaControl
									__nextHasNoMarginBottom
									label={ __( 'Notes', 'fair-events' ) }
									value={ form.note }
									onChange={ ( value ) =>
										change( { note: value } )
									}
								/>
								{ saveError && (
									<Notice
										status="error"
										isDismissible={ false }
									>
										{ saveError }
									</Notice>
								) }
								{ saved && ! dirty && (
									<Notice
										status="success"
										isDismissible={ false }
									>
										{ __(
											'Staging verification saved.',
											'fair-events'
										) }
									</Notice>
								) }
								<div>
									<Button
										variant="primary"
										onClick={ save }
										isBusy={ saving }
										disabled={
											saving ||
											missingDate ||
											missingEventsVersion
										}
										accessibleWhenDisabled
									>
										{ saving
											? __( 'Saving…', 'fair-events' )
											: __(
													'Save staging verification',
													'fair-events'
												) }
									</Button>
									{ missingDate && (
										<p className="fair-events-payment-history__hint">
											{ __(
												'Enter the date of the staging verification.',
												'fair-events'
											) }
										</p>
									) }
									{ ! missingDate && missingEventsVersion && (
										<p className="fair-events-payment-history__hint">
											{ __(
												'Enter the Fair Events version staging ran.',
												'fair-events'
											) }
										</p>
									) }
									{ dirty && (
										<p className="fair-events-payment-history__hint">
											{ __(
												'You have unsaved changes.',
												'fair-events'
											) }
										</p>
									) }
								</div>
							</VStack>
						</div>
					) }
				</VStack>
			</CardBody>

			{ confirming && (
				<ConfirmActionModal
					title={ __( 'Remove old payment records', 'fair-events' ) }
					confirmLabel={ __( 'Remove old records', 'fair-events' ) }
					busyLabel={ __( 'Removing…', 'fair-events' ) }
					isDestructive
					isBusy={ cleaning }
					confirmDisabled={ ! backupConfirmed }
					error={ cleanupError }
					onCancel={ closeCleanup }
					onConfirm={ runCleanup }
				>
					<p>
						{ __(
							'This permanently deletes what only the payment history migration used. Nothing reads it any more:',
							'fair-events'
						) }
					</p>
					<ul className="fair-events-payment-history__tables">
						{ CLEANUP_TABLES.map( ( table ) => (
							<li key={ table }>
								<code>{ table }</code>{ ' ' }
								{ __( '(table)', 'fair-events' ) }
							</li>
						) ) }
						{ CLEANUP_OPTIONS.map( ( option ) => (
							<li key={ option }>
								<code>{ option }</code>{ ' ' }
								{ __( '(option)', 'fair-events' ) }
							</li>
						) ) }
						<li>
							{ __(
								'Findings recorded by dry runs',
								'fair-events'
							) }
						</li>
					</ul>
					<p>
						{ __(
							'Findings about Fair Audience payment records keep a copy of the record. Purchases, payment links, findings to review, the decisions made on them, registrations, fee payments and the upgrade evidence stay as they are. Nothing is charged, refunded or emailed.',
							'fair-events'
						) }
					</p>
					<p>
						{ __(
							'It can’t be undone. Take a fresh database backup that includes these tables first:',
							'fair-events'
						) }
					</p>
					<ul className="fair-events-payment-history__tables">
						{ CLEANUP_BACKUP_TABLES.map( ( table ) => (
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
						disabled={ cleaning }
					/>
				</ConfirmActionModal>
			) }
		</Card>
	);
}

/**
 * The cleanup's state: done, ready to run, blocked or not applicable.
 *
 * @param {Object}   props
 * @param {Object}   props.cleanup  `ready_for_cleanup` from the API.
 * @param {Object}   props.labels   Blocker labels.
 * @param {boolean}  props.justDone Whether this page just ran it.
 * @param {Function} props.onStart  Opens the confirmation.
 * @return {JSX.Element} Section content.
 */
function CleanupSection( { cleanup, labels, justDone, onStart } ) {
	if ( ! cleanup.applicable ) {
		return (
			<p className="fair-events-payment-history__hint">
				{ __(
					'This site has no old payment records to remove.',
					'fair-events'
				) }
			</p>
		);
	}

	const completed = cleanup.completed;
	if ( completed ) {
		const when = formatUtcDateTime( completed.completed_at );
		return (
			<Notice status="success" isDismissible={ false }>
				{ justDone && (
					<p>
						{ __( 'Old payment records removed.', 'fair-events' ) }
					</p>
				) }
				<p>
					{ completed.user_name
						? sprintf(
								/* translators: 1: date and time, 2: administrator's name */
								__(
									'The old payment records were removed on %1$s by %2$s.',
									'fair-events'
								),
								when,
								completed.user_name
							)
						: sprintf(
								/* translators: %s: date and time */
								__(
									'The old payment records were removed on %s.',
									'fair-events'
								),
								when
							) }
				</p>
			</Notice>
		);
	}

	if ( cleanup.ready ) {
		return (
			<>
				<p className="fair-events-payment-history__hint">
					{ __(
						'Fair Audience’s old payment records and the migration’s own records are no longer used. You can remove them once you have a backup.',
						'fair-events'
					) }
				</p>
				<div>
					<Button
						variant="secondary"
						isDestructive
						onClick={ onStart }
					>
						{ __( 'Remove old records…', 'fair-events' ) }
					</Button>
				</div>
			</>
		);
	}

	return (
		<>
			<p className="fair-events-payment-history__hint">
				{ __(
					'Not ready to remove Fair Audience’s old payment records. Being safe to upgrade isn’t enough:',
					'fair-events'
				) }
			</p>
			<ul className="fair-events-payment-history__list">
				{ cleanup.blockers.map( ( code ) => (
					<li key={ code }>{ labels[ code ] ?? code }</li>
				) ) }
			</ul>
		</>
	);
}
