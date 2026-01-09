import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, Spinner } from '@wordpress/components';

export default function PollsList() {
	const [polls, setPolls] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		loadPolls();
	}, []);

	const loadPolls = () => {
		setIsLoading(true);
		apiFetch({ path: '/fair-audience/v1/polls' })
			.then((data) => {
				setPolls(data);
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
					'Are you sure you want to delete this poll?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/polls/${id}`,
			method: 'DELETE',
		})
			.then(() => {
				loadPolls();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	const getStatusBadgeColor = (status) => {
		switch (status) {
			case 'active':
				return '#00a32a';
			case 'closed':
				return '#757575';
			case 'draft':
			default:
				return '#f0b849';
		}
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Polls', 'fair-audience')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Polls', 'fair-audience')}</h1>
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{__('Polls', 'fair-audience')}
			</h1>
			<a
				href="admin.php?page=fair-audience-edit-poll"
				className="page-title-action"
			>
				{__('Add New', 'fair-audience')}
			</a>

			<Card style={{ marginTop: '20px' }}>
				<CardBody>
					{polls.length === 0 ? (
						<p>
							{__(
								'No polls found. Create your first poll to get started.',
								'fair-audience'
							)}
						</p>
					) : (
						<table className="wp-list-table widefat fixed striped">
							<thead>
								<tr>
									<th>{__('Title', 'fair-audience')}</th>
									<th>{__('Question', 'fair-audience')}</th>
									<th>{__('Status', 'fair-audience')}</th>
									<th>{__('Created', 'fair-audience')}</th>
									<th>{__('Actions', 'fair-audience')}</th>
								</tr>
							</thead>
							<tbody>
								{polls.map((poll) => (
									<tr key={poll.id}>
										<td>
											<strong>{poll.title}</strong>
										</td>
										<td>
											{poll.question.length > 100
												? poll.question.substring(
														0,
														100
													) + '...'
												: poll.question}
										</td>
										<td>
											<span
												style={{
													padding: '3px 8px',
													borderRadius: '3px',
													backgroundColor:
														getStatusBadgeColor(
															poll.status
														),
													color: '#fff',
													fontSize: '12px',
													fontWeight: '500',
												}}
											>
												{poll.status}
											</span>
										</td>
										<td>
											{new Date(
												poll.created_at
											).toLocaleDateString()}
										</td>
										<td>
											<Button
												isLink
												href={`admin.php?page=fair-audience-edit-poll&poll_id=${poll.id}`}
											>
												{__('Edit', 'fair-audience')}
											</Button>
											{' | '}
											<Button
												isLink
												onClick={() =>
													handleDelete(poll.id)
												}
												style={{ color: '#b32d2e' }}
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
