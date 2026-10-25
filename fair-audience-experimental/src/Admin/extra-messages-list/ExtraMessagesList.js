import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, Notice, Spinner } from '@wordpress/components';

import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';

export default function ExtraMessagesList() {
	const [ messages, setMessages ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	// Result of the last delete or status change: { status, message }.
	const [ notice, setNotice ] = useState( null );
	const [ togglingId, setTogglingId ] = useState( null );
	const deleteMessage = useConfirmAction();

	useEffect( () => {
		loadMessages();
	}, [] );

	const loadMessages = () => {
		setIsLoading( true );
		apiFetch( { path: '/fair-audience/v1/extra-messages' } )
			.then( ( data ) => {
				setMessages( data );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setIsLoading( false );
			} );
	};

	const handleDelete = () =>
		deleteMessage.run(
			async ( msg ) => {
				await apiFetch( {
					path: `/fair-audience/v1/extra-messages/${ msg.id }`,
					method: 'DELETE',
				} );
				setNotice( {
					status: 'success',
					message: __(
						'Extra message deleted.',
						'fair-audience-experimental'
					),
				} );
				loadMessages();
			},
			__(
				'The extra message could not be deleted. Try again.',
				'fair-audience-experimental'
			)
		);

	const handleToggleActive = ( msg ) => {
		if ( togglingId ) {
			return;
		}
		setTogglingId( msg.id );
		setNotice( null );
		apiFetch( {
			path: `/fair-audience/v1/extra-messages/${ msg.id }`,
			method: 'PUT',
			data: {
				content: msg.content,
				is_active: ! msg.is_active,
				category_id: msg.category_id,
			},
		} )
			.then( () => {
				loadMessages();
			} )
			.catch( ( err ) => {
				setNotice( {
					status: 'error',
					message:
						err.message ||
						__(
							'The message status could not be changed. Try again.',
							'fair-audience-experimental'
						),
				} );
			} )
			.finally( () => setTogglingId( null ) );
	};

	const truncateContent = ( content, maxLength = 80 ) => {
		if ( content.length <= maxLength ) {
			return content;
		}
		return content.substring( 0, maxLength ) + '...';
	};

	if ( isLoading ) {
		return (
			<div className="wrap">
				<h1>
					{ __( 'Extra Messages', 'fair-audience-experimental' ) }
				</h1>
				<Spinner />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="wrap">
				<h1>
					{ __( 'Extra Messages', 'fair-audience-experimental' ) }
				</h1>
				<div className="notice notice-error">
					<p>{ error }</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{ __( 'Extra Messages', 'fair-audience-experimental' ) }
			</h1>
			<a
				href="admin.php?page=fair-audience-edit-extra-message"
				className="page-title-action"
			>
				{ __( 'Add New', 'fair-audience-experimental' ) }
			</a>

			{ notice && (
				<Notice
					status={ notice.status }
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			{ deleteMessage.target && (
				<ConfirmActionModal
					title={ __(
						'Delete extra message',
						'fair-audience-experimental'
					) }
					confirmLabel={ __(
						'Delete message',
						'fair-audience-experimental'
					) }
					busyLabel={ __(
						'Deleting…',
						'fair-audience-experimental'
					) }
					isDestructive
					isBusy={ deleteMessage.isBusy }
					error={ deleteMessage.error }
					onConfirm={ handleDelete }
					onCancel={ deleteMessage.close }
				>
					<blockquote style={ { margin: 0, whiteSpace: 'pre-wrap' } }>
						{ truncateContent( deleteMessage.target.content, 300 ) }
					</blockquote>
					<p>
						{ sprintf(
							/* translators: %s: category name, or "All" */
							__( 'Category: %s', 'fair-audience-experimental' ),
							deleteMessage.target.category_name ||
								__( 'All', 'fair-audience-experimental' )
						) }
					</p>
					<p>
						{ __(
							'Emails sent from now on no longer include it; emails already sent are not changed. To pause it instead, set it to Inactive. Deleting cannot be undone.',
							'fair-audience-experimental'
						) }
					</p>
				</ConfirmActionModal>
			) }

			<Card style={ { marginTop: '20px' } }>
				<CardBody>
					{ messages.length === 0 ? (
						<p>
							{ __(
								'No extra messages found. Create your first extra message to get started.',
								'fair-audience-experimental'
							) }
						</p>
					) : (
						<table className="wp-list-table widefat fixed striped">
							<thead>
								<tr>
									<th>
										{ __(
											'Content',
											'fair-audience-experimental'
										) }
									</th>
									<th>
										{ __(
											'Category',
											'fair-audience-experimental'
										) }
									</th>
									<th>
										{ __(
											'Status',
											'fair-audience-experimental'
										) }
									</th>
									<th>
										{ __(
											'Actions',
											'fair-audience-experimental'
										) }
									</th>
								</tr>
							</thead>
							<tbody>
								{ messages.map( ( msg ) => (
									<tr key={ msg.id }>
										<td>
											{ truncateContent( msg.content ) }
										</td>
										<td>
											{ msg.category_name ||
												__(
													'All',
													'fair-audience-experimental'
												) }
										</td>
										<td>
											<Button
												isSmall
												variant={
													msg.is_active
														? 'primary'
														: 'secondary'
												}
												onClick={ () =>
													handleToggleActive( msg )
												}
												isBusy={ togglingId === msg.id }
												disabled={ !! togglingId }
											>
												{ msg.is_active
													? __(
															'Active',
															'fair-audience-experimental'
														)
													: __(
															'Inactive',
															'fair-audience-experimental'
														) }
											</Button>
										</td>
										<td>
											<Button
												isLink
												href={ `admin.php?page=fair-audience-edit-extra-message&message_id=${ msg.id }` }
											>
												{ __(
													'Edit',
													'fair-audience-experimental'
												) }
											</Button>
											{ ' | ' }
											<Button
												isLink
												onClick={ () => {
													setNotice( null );
													deleteMessage.open( msg );
												} }
												style={ {
													color: '#b32d2e',
												} }
											>
												{ __(
													'Delete',
													'fair-audience-experimental'
												) }
											</Button>
										</td>
									</tr>
								) ) }
							</tbody>
						</table>
					) }
				</CardBody>
			</Card>
		</div>
	);
}
