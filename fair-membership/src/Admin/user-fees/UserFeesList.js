import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

const UserFeesList = ({
	userFees,
	onEdit,
	onDelete,
	onMarkAsPaid,
	onAdjust,
}) => {
	if (!userFees || userFees.length === 0) {
		return (
			<p style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
				{__('No user fees found.', 'fair-membership')}
			</p>
		);
	}

	const getStatusBadge = (status) => {
		const styles = {
			pending: { backgroundColor: '#f0f0f1', color: '#2c3338' },
			paid: { backgroundColor: '#00a32a', color: '#fff' },
			overdue: { backgroundColor: '#d63638', color: '#fff' },
			cancelled: { backgroundColor: '#dba617', color: '#fff' },
		};

		const style = styles[status] || styles.pending;

		return (
			<span
				style={{
					...style,
					padding: '2px 8px',
					borderRadius: '3px',
					fontSize: '12px',
					fontWeight: '500',
				}}
			>
				{status.charAt(0).toUpperCase() + status.slice(1)}
			</span>
		);
	};

	return (
		<table className="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th>{__('User', 'fair-membership')}</th>
					<th>{__('Title', 'fair-membership')}</th>
					<th>{__('Amount', 'fair-membership')}</th>
					<th>{__('Due Date', 'fair-membership')}</th>
					<th>{__('Status', 'fair-membership')}</th>
					<th>{__('Actions', 'fair-membership')}</th>
				</tr>
			</thead>
			<tbody>
				{userFees.map((userFee) => (
					<tr key={userFee.id}>
						<td>
							{userFee.user_display_name ||
								`User #${userFee.user_id}`}
							{userFee.user_email && (
								<div
									style={{ fontSize: '13px', color: '#666' }}
								>
									{userFee.user_email}
								</div>
							)}
						</td>
						<td>
							<strong>{userFee.title}</strong>
							{userFee.notes && (
								<div
									style={{ fontSize: '13px', color: '#666' }}
								>
									{userFee.notes}
								</div>
							)}
						</td>
						<td>${parseFloat(userFee.amount).toFixed(2)}</td>
						<td>{userFee.due_date}</td>
						<td>{getStatusBadge(userFee.status)}</td>
						<td>
							{userFee.status === 'paid' ? (
								<span
									style={{
										color: '#757575',
										fontSize: '13px',
										fontStyle: 'italic',
									}}
									title={__(
										'Cannot edit or delete paid fees',
										'fair-membership'
									)}
								>
									{__('Already paid', 'fair-membership')}
								</span>
							) : (
								<>
									{userFee.status === 'pending' && (
										<>
											<Button
												variant="link"
												onClick={() =>
													onMarkAsPaid(userFee)
												}
												style={{ marginRight: '8px' }}
											>
												{__(
													'Mark Paid',
													'fair-membership'
												)}
											</Button>
											<Button
												variant="link"
												onClick={() => onAdjust(userFee)}
												style={{ marginRight: '8px' }}
											>
												{__('Adjust', 'fair-membership')}
											</Button>
										</>
									)}
									<Button
										variant="link"
										onClick={() => onEdit(userFee)}
										style={{ marginRight: '8px' }}
									>
										{__('Edit', 'fair-membership')}
									</Button>
									<Button
										variant="link"
										isDestructive
										onClick={() => onDelete(userFee)}
									>
										{__('Delete', 'fair-membership')}
									</Button>
								</>
							)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
};

export default UserFeesList;
