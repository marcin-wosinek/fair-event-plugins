/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import RunResultNotice from './RunResultNotice.js';
import { startRun, errorMessage } from '../runs-api.js';

const ACTION = 'import_connected_site';

/**
 * Import transactions from each enabled connected site.
 *
 * Connected sites belong to Fair Payments Connector Experimental; without
 * its admin endpoint this panel explains how to set them up instead.
 *
 * @param {Object}   props
 * @param {string}   props.activeAction Key of the action running on the page, or null.
 * @param {Function} props.onBegin      Claims the page-wide busy state; returns false when busy.
 * @param {Function} props.onEnd        Releases the busy state and refreshes the log.
 * @return {JSX.Element} Panel.
 */
const ConnectedSitesPanel = ( { activeAction, onBegin, onEnd } ) => {
	const settings = window.fairPaymentsExternalUpdates || {};
	const [ sites, setSites ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ unavailable, setUnavailable ] = useState( false );
	const [ loadError, setLoadError ] = useState( null );
	const [ busySiteId, setBusySiteId ] = useState( null );
	const [ result, setResult ] = useState( null );

	useEffect( () => {
		apiFetch( {
			path: '/fair-payments-connector/v1/admin/connected-sites',
		} )
			.then( ( data ) => setSites( Array.isArray( data ) ? data : [] ) )
			.catch( ( err ) => {
				if ( err?.code === 'rest_no_route' ) {
					setUnavailable( true );
				} else {
					setLoadError(
						errorMessage(
							err,
							__(
								'Failed to load connected sites.',
								'fair-payments-connector'
							)
						)
					);
				}
			} )
			.finally( () => setLoading( false ) );
	}, [] );

	const handleImport = async ( site ) => {
		if ( ! onBegin( `${ ACTION }:${ site.id }` ) ) {
			return;
		}
		setBusySiteId( site.id );
		setResult( null );

		try {
			const { run } = await startRun( ACTION, site.id );
			try {
				const response = await apiFetch( {
					path: `/fair-payments-connector/v1/admin/connected-sites/${ site.id }/import-transactions`,
					method: 'POST',
					data: { run_id: run.id },
				} );
				setResult( { run: response.run, error: null } );
			} catch ( err ) {
				setResult( {
					run: err?.data?.run || null,
					error: errorMessage(
						err,
						__(
							'The import request did not complete. Check the operation log for its outcome.',
							'fair-payments-connector'
						)
					),
				} );
			}
		} catch ( err ) {
			setResult( {
				run: null,
				error: errorMessage(
					err,
					__(
						'The import could not be started.',
						'fair-payments-connector'
					)
				),
			} );
		} finally {
			setBusySiteId( null );
			onEnd();
		}
	};

	const renderBody = () => {
		if ( loading ) {
			return (
				<HStack justify="flex-start">
					<Spinner />
					<span>
						{ __( 'Loading sites…', 'fair-payments-connector' ) }
					</span>
				</HStack>
			);
		}

		if ( unavailable ) {
			return (
				<p>
					{ __(
						'Importing from other sites needs the Fair Payments Connector Experimental plugin. Activate it, then add a site on its Connected Sites page.',
						'fair-payments-connector'
					) }
				</p>
			);
		}

		if ( loadError ) {
			return (
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
			);
		}

		if ( sites.length === 0 ) {
			return (
				<p>
					{ __(
						'No connected sites yet.',
						'fair-payments-connector'
					) }{ ' ' }
					<a href={ settings.connectedSitesUrl }>
						{ __(
							'Add one on the Connected Sites page.',
							'fair-payments-connector'
						) }
					</a>
				</p>
			);
		}

		return (
			<ul className="fair-external-updates__sites">
				{ sites.map( ( site ) => {
					const enabled = site.enabled !== false;
					return (
						<li
							key={ site.id }
							className="fair-external-updates__site"
						>
							<div className="fair-external-updates__site-info">
								<strong>{ site.label }</strong>
								<span className="fair-external-updates__muted">
									{ site.base_url }
								</span>
								{ ! enabled && (
									<span className="fair-external-updates__muted">
										{ __(
											'Disabled. Enable it on the Connected Sites page to import from it.',
											'fair-payments-connector'
										) }
									</span>
								) }
							</div>
							<Button
								variant="secondary"
								isBusy={ busySiteId === site.id }
								disabled={ ! enabled || activeAction !== null }
								onClick={ () => handleImport( site ) }
								aria-label={ sprintf(
									/* translators: %s: connected site label */
									__(
										'Import transactions from %s',
										'fair-payments-connector'
									),
									site.label
								) }
							>
								{ busySiteId === site.id
									? __(
											'Importing…',
											'fair-payments-connector'
									  )
									: __(
											'Import transactions',
											'fair-payments-connector'
									  ) }
							</Button>
						</li>
					);
				} ) }
			</ul>
		);
	};

	return (
		<Card>
			<CardHeader>
				<h2 className="fair-external-updates__title">
					{ __( 'Connected sites', 'fair-payments-connector' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 3 }>
					<p className="fair-external-updates__intro">
						{ __(
							'Pull transactions from another site. Transactions already here are matched by payment ID and updated, never duplicated.',
							'fair-payments-connector'
						) }
					</p>
					<RunResultNotice
						run={ result?.run }
						error={ result?.error }
						onClose={ () => setResult( null ) }
					/>
					{ renderBody() }
				</VStack>
			</CardBody>
		</Card>
	);
};

export default ConnectedSitesPanel;
