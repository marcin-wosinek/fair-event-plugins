import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { PanelBody } from '@wordpress/components';

export default function EditComponent() {
	const blockProps = useBlockProps({
		className: 'fair-membership-my-fees-editor',
	});

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Block Information', 'fair-membership')}>
					<p>
						{__(
							"This block displays the current user's membership fees on the frontend.",
							'fair-membership'
						)}
					</p>
					<p>
						{__(
							'The content is dynamically generated based on the logged-in user.',
							'fair-membership'
						)}
					</p>
				</PanelBody>
			</InspectorControls>
			<div {...blockProps}>
				<div className="block-editor-preview">
					<h3>{__('My Fees', 'fair-membership')}</h3>
					<p>
						{__(
							"Preview: This block displays the current user's membership fees.",
							'fair-membership'
						)}
					</p>
					<div className="preview-table">
						<table>
							<thead>
								<tr>
									<th>{__('Title', 'fair-membership')}</th>
									<th>{__('Amount', 'fair-membership')}</th>
									<th>{__('Due Date', 'fair-membership')}</th>
									<th>{__('Status', 'fair-membership')}</th>
									<th>{__('Actions', 'fair-membership')}</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>
										{__(
											'Membership Fee',
											'fair-membership'
										)}
									</td>
									<td>€50.00</td>
									<td>2025-01-31</td>
									<td>
										<span className="fee-status-badge fee-status-pending">
											{__('Pending', 'fair-membership')}
										</span>
									</td>
									<td>{__('Pay Now', 'fair-membership')}</td>
								</tr>
								<tr>
									<td>
										{__(
											'Annual Renewal',
											'fair-membership'
										)}
									</td>
									<td>€100.00</td>
									<td>2024-12-01</td>
									<td>
										<span className="fee-status-badge fee-status-overdue">
											{__('Overdue', 'fair-membership')}
										</span>
									</td>
									<td>{__('Pay Now', 'fair-membership')}</td>
								</tr>
								<tr>
									<td>
										{__('Registration', 'fair-membership')}
									</td>
									<td>€25.00</td>
									<td>2024-11-15</td>
									<td>
										<span className="fee-status-badge fee-status-paid">
											{__('Paid', 'fair-membership')}
										</span>
									</td>
									<td>—</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}
