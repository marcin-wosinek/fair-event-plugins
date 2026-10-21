/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import MetaConversions from './MetaConversions.js';

/**
 * Fair Events → Meta: Meta Conversions settings, test events and delivery
 * diagnostics, with page-level notices above them.
 *
 * @return {JSX.Element} The Meta page.
 */
export default function MetaPage() {
	const [ notice, setNotice ] = useState( null );

	return (
		<div className="wrap fair-events-meta">
			<h1>{ __( 'Meta', 'fair-events-experimental' ) }</h1>

			{ notice && (
				<Notice
					status={ notice.status }
					isDismissible
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<MetaConversions onNotice={ setNotice } />
		</div>
	);
}
