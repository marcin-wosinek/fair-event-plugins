/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Card, CardBody } from '@wordpress/components';

/**
 * Where the Instagram connection went while Fair Events Experimental
 * manages it: its own page under Fair Events.
 *
 * @param {Object} props
 * @param {string} props.url Fair Events → Instagram page.
 * @return {JSX.Element} The card.
 */
export default function InstagramMoved( { url } ) {
	return (
		<Card>
			<CardBody>
				<h2>{ __( 'Instagram Connection', 'fair-audience' ) }</h2>
				<p>
					{ __(
						'The Instagram connection is managed in Fair Events → Instagram: connecting, testing and disconnecting the account. The connected account and its stored token are unchanged, and Instagram Posts keeps using it.',
						'fair-audience'
					) }
				</p>
				<p>
					<a href={ url }>
						{ __(
							'Open Fair Events → Instagram',
							'fair-audience'
						) }
					</a>
				</p>
			</CardBody>
		</Card>
	);
}
