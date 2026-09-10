import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ConfirmDialog,
	TextControl,
} from '@wordpress/components';

const PATH = '/fair-events-experimental/v1/meta-conversions';

export default function MetaConversions( { onNotice } ) {
	const [ config, setConfig ] = useState( null );
	const [ token, setToken ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ confirming, setConfirming ] = useState( false );
	const load = () =>
		apiFetch( { path: PATH } )
			.then( setConfig )
			.catch( () =>
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load Meta Conversions settings.',
						'fair-events-experimental'
					),
				} )
			);
	useEffect( load, [] );
	if ( ! config ) {
		return (
			<p>
				{ __(
					'Loading Meta Conversions settings…',
					'fair-events-experimental'
				) }
			</p>
		);
	}
	const ready =
		config.dataset_id && config.token_configured && config.test_event_code;
	const save = async () => {
		setBusy( true );
		try {
			const next = await apiFetch( {
				path: PATH,
				method: 'POST',
				data: {
					dataset_id: config.dataset_id,
					test_event_code: config.test_event_code,
					access_token: token,
				},
			} );
			setConfig( next );
			setToken( '' );
			onNotice( {
				status: 'success',
				message: __(
					'Meta Conversions settings saved.',
					'fair-events-experimental'
				),
			} );
		} catch {
			onNotice( {
				status: 'error',
				message: __(
					'Failed to save Meta Conversions settings.',
					'fair-events-experimental'
				),
			} );
		}
		setBusy( false );
	};
	const clearToken = async () => {
		setBusy( true );
		const next = await apiFetch( {
			path: `${ PATH }/token`,
			method: 'DELETE',
		} );
		setConfig( next );
		setConfirming( false );
		setBusy( false );
	};
	const sendTest = async () => {
		setBusy( true );
		try {
			await apiFetch( { path: `${ PATH }/test`, method: 'POST' } );
			onNotice( {
				status: 'success',
				message: __(
					'Meta accepted the test event.',
					'fair-events-experimental'
				),
			} );
		} catch {
			onNotice( {
				status: 'error',
				message: __(
					'Meta rejected the test event. Check the configuration and try again.',
					'fair-events-experimental'
				),
			} );
		}
		setBusy( false );
	};
	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>
					{ __( 'Meta Conversions', 'fair-events-experimental' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'Send consented checkout and purchase measurements to Meta. Matching identifiers are removed when delivery finishes and records are deleted after 90 days.',
						'fair-events-experimental'
					) }
				</p>
				<TextControl
					label={ __(
						'Dataset / Pixel ID',
						'fair-events-experimental'
					) }
					value={ config.dataset_id }
					onChange={ ( dataset_id ) =>
						setConfig( { ...config, dataset_id } )
					}
				/>
				<TextControl
					type="password"
					label={
						config.token_configured
							? __(
									'Replace access token',
									'fair-events-experimental'
							  )
							: __( 'Access token', 'fair-events-experimental' )
					}
					help={
						config.token_configured
							? __(
									'A token is configured. Leave this empty to keep it.',
									'fair-events-experimental'
							  )
							: __(
									'The token is write-only and will not be shown again.',
									'fair-events-experimental'
							  )
					}
					value={ token }
					onChange={ setToken }
				/>
				{ config.token_configured && (
					<Button
						isDestructive
						variant="secondary"
						onClick={ () => setConfirming( true ) }
						disabled={ busy }
					>
						{ __(
							'Clear access token',
							'fair-events-experimental'
						) }
					</Button>
				) }
				<TextControl
					label={ __(
						'Test Events code',
						'fair-events-experimental'
					) }
					value={ config.test_event_code }
					onChange={ ( test_event_code ) =>
						setConfig( { ...config, test_event_code } )
					}
				/>
				<p>
					<Button
						variant="primary"
						onClick={ save }
						isBusy={ busy }
						disabled={ busy }
					>
						{ __(
							'Save Meta settings',
							'fair-events-experimental'
						) }
					</Button>{ ' ' }
					<Button
						variant="secondary"
						onClick={ sendTest }
						disabled={ busy || ! ready }
					>
						{ __( 'Send test event', 'fair-events-experimental' ) }
					</Button>
				</p>
				{ ! ready && (
					<p className="description">
						{ __(
							'Configure the dataset ID, access token, and Test Events code before sending a test event.',
							'fair-events-experimental'
						) }
					</p>
				) }
				<h3>
					{ __(
						'Recent delivery outcomes',
						'fair-events-experimental'
					) }
				</h3>
				<ul>
					{ Object.entries( config.diagnostics.counts || {} ).map(
						( [ state, count ] ) => (
							<li key={ state }>
								{ state }: { count }
							</li>
						)
					) }
				</ul>
				<ul>
					{ ( config.diagnostics.recent || [] ).map(
						( outcome, index ) => (
							<li key={ `${ outcome.updated_at }-${ index }` }>
								{ outcome.event_name }: { outcome.state } (
								{ outcome.attempt_count })
							</li>
						)
					) }
				</ul>
				{ confirming && (
					<ConfirmDialog
						onConfirm={ clearToken }
						onCancel={ () => setConfirming( false ) }
						confirmButtonText={ __(
							'Clear access token',
							'fair-events-experimental'
						) }
					>
						{ __(
							'Clear the Meta access token? Conversion delivery will stop until a new token is saved.',
							'fair-events-experimental'
						) }
					</ConfirmDialog>
				) }
			</CardBody>
		</Card>
	);
}
