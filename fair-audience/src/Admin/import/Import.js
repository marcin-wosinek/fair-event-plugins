import { __ } from '@wordpress/i18n';
import { Card, CardBody } from '@wordpress/components';

export default function Import() {
	return (
		<div className="wrap">
			<h1>{__('Import Participants', 'fair-audience')}</h1>
			<Card>
				<CardBody>
					<p>
						{__(
							'Import functionality will be implemented in a future version.',
							'fair-audience'
						)}
					</p>
				</CardBody>
			</Card>
		</div>
	);
}
