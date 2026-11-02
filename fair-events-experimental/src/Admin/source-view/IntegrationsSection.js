/**
 * Subscription and integrations - slug and calendar feed URLs, collapsed.
 *
 * @package FairEventsExperimental
 */

import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import CopyUrlButton from '../components/CopyUrlButton.js';
import Disclosure from './Disclosure.js';

/**
 * @param {Object} props
 * @param {Object} props.source  Event feed
 * @param {string} props.icalUrl iCal feed URL
 * @param {string} props.jsonUrl JSON API URL
 * @return {JSX.Element} The section
 */
export default function IntegrationsSection( { source, icalUrl, jsonUrl } ) {
	const [ isOpen, setIsOpen ] = useState( false );

	return (
		<section className="fair-events-feed-section fair-events-feed-section--compact">
			<Disclosure
				label={ __(
					'Subscription and integrations',
					'fair-events-experimental'
				) }
				isOpen={ isOpen }
				onToggle={ setIsOpen }
			>
				<p className="fair-events-feed-section__text">
					{ __(
						'Use these addresses to subscribe to the feed in a calendar app or to connect it to another site.',
						'fair-events-experimental'
					) }
				</p>
				<dl className="fair-events-feed-integrations">
					<dt>{ __( 'Slug', 'fair-events-experimental' ) }</dt>
					<dd>
						<code>{ source.slug }</code>
					</dd>
					<dt>{ __( 'Feed URLs', 'fair-events-experimental' ) }</dt>
					<dd className="fair-events-feed-section__actions">
						<CopyUrlButton
							url={ icalUrl }
							label={ __( 'iCal', 'fair-events-experimental' ) }
							tooltip={ __(
								'Copy iCal feed URL',
								'fair-events-experimental'
							) }
						/>
						<CopyUrlButton
							url={ jsonUrl }
							label={ __( 'JSON', 'fair-events-experimental' ) }
							tooltip={ __(
								'Copy JSON API URL',
								'fair-events-experimental'
							) }
						/>
					</dd>
				</dl>
			</Disclosure>
		</section>
	);
}
