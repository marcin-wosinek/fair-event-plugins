import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, Notice, Spinner } from '@wordpress/components';

import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';

export default function PollsList() {
	const [ polls, setPolls ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ notice, setNotice ] = useState( null );
	const deletePoll = useConfirmAction();

	useEffect( () => {
		loadPolls();
	}, [] );

	const loadPolls = () => {
		setIsLoading( true );
		apiFetch( { path: '/fair-audience/v1/polls' } )
			.then( ( data ) => {
				setPolls( data );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setIsLoading( false );
			} );
	};

	const handleDelete = () =>
		deletePoll.run(
			async ( poll ) => {
				await apiFetch( {
					path: `/fair-audience/v1/polls/${ poll.id }`,
					method: 'DELETE',
				} );
				setNotice(
					sprintf(
						/* translators: %s: poll title */
						__(
							'Poll “%s” deleted.',
							'fair-audience-experimental'
						),
						poll.title
					)
				);
				loadPolls();
			},
			__(
				'The poll could not be deleted. Try again.',
				'fair-audience-experimental'
			)
		);

	const getStatusBadgeColor = ( status ) => {
		switch ( status ) {
			case 'active':
				return '#00a32a';
			case 'closed':
				return '#757575';
			case 'draft':
			default:
				return '#f0b849';
		}
	};

	if ( isLoading ) {
		return (
			<div className="wrap">
				<h1>{ __( 'Polls', 'fair-audience-experimental' ) }</h1>
				<Spinner />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="wrap">
				<h1>{ __( 'Polls', 'fair-audience-experimental' ) }</h1>
				<div className="notice notice-error">
					<p>{ error }</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{ __( 'Polls', 'fair-audience-experimental' ) }
			</h1>
			<a
				href="admin.php?page=fair-audience-edit-poll"
				className="page-title-action"
			>
				{ __( 'Add New', 'fair-audience-experimental' ) }
			</a>

			{ notice && (
				<Notice status="success" onRemove={ () => setNotice( null ) }>
					{ notice }
				</Notice>
			) }

			{ deletePoll.target && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: poll title */
						__( 'Delete poll — %s', 'fair-audience-experimental' ),
						deletePoll.target.title
					) }
					confirmLabel={ __(
						'Delete poll',
						'fair-audience-experimental'
					) }
					busyLabel={ __(
						'Deleting…',
						'fair-audience-experimental'
					) }
					isDestructive
					isBusy={ deletePoll.isBusy }
					error={ deletePoll.error }
					onConfirm={ handleDelete }
					onCancel={ deletePoll.close }
				>
					<p>{ deletePoll.target.question }</p>
					<p>
						{ __(
							'Invitation links already sent stop working, and its responses are no longer shown. This cannot be undone.',
							'fair-audience-experimental'
						) }
					</p>
				</ConfirmActionModal>
			) }

			<Card style={ { marginTop: '20px' } }>
				<CardBody>
					{ polls.length === 0 ? (
						<p>
							{ __(
								'No polls found. Create your first poll to get started.',
								'fair-audience-experimental'
							) }
						</p>
					) : (
						<table className="wp-list-table widefat fixed striped">
							<thead>
								<tr>
									<th>
										{ __(
											'Title',
											'fair-audience-experimental'
										) }
									</th>
									<th>
										{ __(
											'Question',
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
											'Created',
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
								{ polls.map( ( poll ) => (
									<tr key={ poll.id }>
										<td>
											<strong>{ poll.title }</strong>
										</td>
										<td>
											{ poll.question.length > 100
												? poll.question.substring(
														0,
														100
													) + '...'
												: poll.question }
										</td>
										<td>
											<span
												style={ {
													padding: '3px 8px',
													borderRadius: '3px',
													backgroundColor:
														getStatusBadgeColor(
															poll.status
														),
													color: '#fff',
													fontSize: '12px',
													fontWeight: '500',
												} }
											>
												{ poll.status }
											</span>
										</td>
										<td>
											{ new Date(
												poll.created_at
											).toLocaleDateString() }
										</td>
										<td>
											<Button
												isLink
												href={ `admin.php?page=fair-audience-edit-poll&poll_id=${ poll.id }` }
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
													deletePoll.open( poll );
												} }
												style={ { color: '#b32d2e' } }
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
