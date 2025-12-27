import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { formatDateOrFallback } from 'fair-events-shared';

const GroupFeesList = ({ groupFees, onEdit, onDelete }) => {
	if (!groupFees || groupFees.length === 0) {
		return (
			<p style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
				{__('No group fees found.', 'fair-membership')}
			</p>
		);
	}

	return (
		<table className="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th>{__('Title', 'fair-membership')}</th>
					<th>{__('Group', 'fair-membership')}</th>
					<th>{__('Amount', 'fair-membership')}</th>
					<th>{__('Total Paid', 'fair-membership')}</th>
					<th>{__('Payment Pending', 'fair-membership')}</th>
					<th>{__('Due Date', 'fair-membership')}</th>
					<th>{__('Created', 'fair-membership')}</th>
					<th>{__('Actions', 'fair-membership')}</th>
				</tr>
			</thead>
			<tbody>
				{groupFees.map((groupFee) => (
					<tr key={groupFee.id}>
						<td>
							<strong>{groupFee.title}</strong>
							{groupFee.description && (
								<div
									style={{ fontSize: '13px', color: '#666' }}
								>
									{groupFee.description}
								</div>
							)}
						</td>
						<td>
							{groupFee.group_name || `#${groupFee.group_id}`}
						</td>
						<td>
							€{parseFloat(groupFee.default_amount).toFixed(2)}
						</td>
						<td>
							<span
								style={{ color: '#2c7a1f', fontWeight: '500' }}
							>
								€
								{parseFloat(groupFee.total_paid || 0).toFixed(
									2
								)}
							</span>
						</td>
						<td>
							<span
								style={{ color: '#d63638', fontWeight: '500' }}
							>
								€
								{parseFloat(
									groupFee.payment_pending || 0
								).toFixed(2)}
							</span>
						</td>
						<td>{formatDateOrFallback(groupFee.due_date)}</td>
						<td>
							{new Date(groupFee.created_at).toLocaleDateString()}
						</td>
						<td>
							<Button
								variant="link"
								onClick={() => onEdit(groupFee)}
								style={{ marginRight: '8px' }}
							>
								{__('Edit', 'fair-membership')}
							</Button>
							<Button
								variant="link"
								isDestructive
								onClick={() => onDelete(groupFee)}
							>
								{__('Delete', 'fair-membership')}
							</Button>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
};

export default GroupFeesList;
