import { __ } from '@wordpress/i18n';
import { Card, CardBody, CardHeader } from '@wordpress/components';

/**
 * Where the Meta Conversions settings went: they have their own page under
 * Fair Events.
 *
 * @param {Object} props
 * @param {string} props.url Meta page.
 * @return {JSX.Element} The card.
 */
export default function MetaMoved( { url } ) {
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
						'Meta Conversions settings, test events and delivery diagnostics are on their own page, Fair Events → Meta.',
						'fair-events-experimental'
					) }
				</p>
				<p>
					<a href={ url }>
						{ __( 'Open Meta', 'fair-events-experimental' ) }
					</a>
				</p>
			</CardBody>
		</Card>
	);
}
