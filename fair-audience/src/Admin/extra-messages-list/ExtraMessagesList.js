import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, Spinner } from '@wordpress/components';

export default function ExtraMessagesList() {
	const [messages, setMessages] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		loadMessages();
	}, []);

	const loadMessages = () => {
		setIsLoading(true);
		apiFetch({ path: '/fair-audience/v1/extra-messages' })
			.then((data) => {
				setMessages(data);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err.message);
				setIsLoading(false);
			});
	};

	const handleDelete = (id) => {
		if (
			!confirm(
				__(
					'Are you sure you want to delete this extra message?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/extra-messages/${id}`,
			method: 'DELETE',
		})
			.then(() => {
				loadMessages();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	const truncateContent = (content, maxLength = 80) => {
		if (content.length <= maxLength) {
			return content;
		}
		return content.substring(0, maxLength) + '...';
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Extra Messages', 'fair-audience')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Extra Messages', 'fair-audience')}</h1>
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{__('Extra Messages', 'fair-audience')}
			</h1>
			<a
				href="admin.php?page=fair-audience-edit-extra-message"
				className="page-title-action"
			>
				{__('Add New', 'fair-audience')}
			</a>

			<Card style={{ marginTop: '20px' }}>
				<CardBody>
					{messages.length === 0 ? (
						<p>
							{__(
								'No extra messages found. Create your first extra message to get started.',
								'fair-audience'
							)}
						</p>
					) : (
						<table className="wp-list-table widefat fixed striped">
							<thead>
								<tr>
									<th>{__('Content', 'fair-audience')}</th>
									<th>{__('Start Date', 'fair-audience')}</th>
									<th>{__('End Date', 'fair-audience')}</th>
									<th>{__('Status', 'fair-audience')}</th>
									<th>{__('Actions', 'fair-audience')}</th>
								</tr>
							</thead>
							<tbody>
								{messages.map((msg) => (
									<tr key={msg.id}>
										<td>{truncateContent(msg.content)}</td>
										<td>{msg.start_date}</td>
										<td>{msg.end_date}</td>
										<td>
											<span
												style={{
													padding: '3px 8px',
													borderRadius: '3px',
													backgroundColor:
														msg.is_active
															? '#00a32a'
															: '#757575',
													color: '#fff',
													fontSize: '12px',
													fontWeight: '500',
												}}
											>
												{msg.is_active
													? __(
															'Active',
															'fair-audience'
													  )
													: __(
															'Inactive',
															'fair-audience'
													  )}
											</span>
										</td>
										<td>
											<Button
												isLink
												href={`admin.php?page=fair-audience-edit-extra-message&message_id=${msg.id}`}
											>
												{__('Edit', 'fair-audience')}
											</Button>
											{' | '}
											<Button
												isLink
												onClick={() =>
													handleDelete(msg.id)
												}
												style={{
													color: '#b32d2e',
												}}
											>
												{__('Delete', 'fair-audience')}
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
