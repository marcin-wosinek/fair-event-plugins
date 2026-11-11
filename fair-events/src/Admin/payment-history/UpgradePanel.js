/**
 * Upgrade readiness after the payment history migration
 * (PAYMENT_HISTORY_MIGRATION.md §8.17): whether this site is safe to run
 * releases without the migration, what is still missing, whether the old
 * records could be removed, and the operator's staging verification.
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

const PATH = '/fair-events/v1/payment-history/upgrade';

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
						{ cleanup.applicable ? (
							<>
								<p className="fair-events-payment-history__hint">
									{ __(
										'Not ready to remove Fair Audience’s old payment records. Being safe to upgrade isn’t enough:',
										'fair-events'
									) }
								</p>
								<ul className="fair-events-payment-history__list">
									{ cleanup.blockers.map( ( code ) => (
										<li key={ code }>
											{ cleanupLabels[ code ] ?? code }
										</li>
									) ) }
								</ul>
							</>
						) : (
							<p className="fair-events-payment-history__hint">
								{ __(
									'This site has no old payment records to remove.',
									'fair-events'
								) }
							</p>
						) }
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
		</Card>
	);
}
