/**
 * Weekly summary section - open or share the WhatsApp summary link.
 *
 * @package FairEventsExperimental
 */

import { useState, useEffect } from '@wordpress/element';
import { Button, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import CopyUrlButton from '../components/CopyUrlButton.js';
import Disclosure from './Disclosure.js';

/**
 * @param {Object} props
 * @param {Object} props.source Event feed
 * @return {JSX.Element} The section
 */
export default function WeeklySummarySection( { source } ) {
	const summaryUrl = source.weekly_summary_url;
	// null, 'copied' or 'failed'.
	const [ copyResult, setCopyResult ] = useState( null );
	const [ isLinkShown, setIsLinkShown ] = useState( false );

	// Feedback about an earlier link would be misleading for a new one.
	useEffect( () => {
		setCopyResult( null );
	}, [ summaryUrl ] );

	const handleCopyError = () => {
		setCopyResult( 'failed' );
		setIsLinkShown( true );
	};

	return (
		<section
			className="fair-events-feed-section"
			aria-labelledby="fair-events-weekly-summary-title"
		>
			<h2
				id="fair-events-weekly-summary-title"
				className="fair-events-feed-section__title"
			>
				{ __( 'Weekly summary', 'fair-events-experimental' ) }
			</h2>
			{ ! summaryUrl ? (
				<p className="fair-events-feed-section__text">
					{ __(
						'Choose a public page for this feed to get a weekly summary link. The page gives the WhatsApp message its title and link.',
						'fair-events-experimental'
					) }
				</p>
			) : (
				<>
					<p className="fair-events-feed-section__text">
						{ __(
							'Send this link to the person who prepares the WhatsApp post. It shows this week’s events as a message ready to copy.',
							'fair-events-experimental'
						) }
					</p>
					<div className="fair-events-feed-section__actions">
						{ source.enabled ? (
							<Button
								variant="secondary"
								href={ summaryUrl }
								target="_blank"
								rel="noopener noreferrer"
							>
								{ __(
									'Open weekly summary',
									'fair-events-experimental'
								) }
								<span className="screen-reader-text">
									{ __(
										'(opens in a new tab)',
										'fair-events-experimental'
									) }
								</span>
								<span aria-hidden="true">&nbsp;&#8599;</span>
							</Button>
						) : (
							<Button
								variant="secondary"
								disabled
								accessibleWhenDisabled
								aria-describedby="fair-events-weekly-summary-disabled"
							>
								{ __(
									'Open weekly summary',
									'fair-events-experimental'
								) }
							</Button>
						) }
						<CopyUrlButton
							url={ summaryUrl }
							size="default"
							label={ __(
								'Copy summary link',
								'fair-events-experimental'
							) }
							tooltip={ __(
								'Copy the weekly summary link to send to the person who posts it',
								'fair-events-experimental'
							) }
							onSuccess={ () => setCopyResult( 'copied' ) }
							onError={ handleCopyError }
						/>
					</div>
					{ ! source.enabled && (
						<p
							id="fair-events-weekly-summary-disabled"
							className="fair-events-feed-section__note"
						>
							{ __(
								'Enable this feed to open its weekly summary. You can copy the link now; it works once the feed is enabled.',
								'fair-events-experimental'
							) }
						</p>
					) }
					<div role="status" className="fair-events-feed-copy-status">
						{ copyResult === 'copied' &&
							__(
								'Summary link copied.',
								'fair-events-experimental'
							) }
					</div>
					{ copyResult === 'failed' && (
						<p
							role="alert"
							className="fair-events-feed-section__error"
						>
							{ __(
								'Couldn’t copy the link. Select it in the field below and copy it by hand.',
								'fair-events-experimental'
							) }
						</p>
					) }
					<Disclosure
						label={ __(
							'Show summary link',
							'fair-events-experimental'
						) }
						isOpen={ isLinkShown }
						onToggle={ setIsLinkShown }
					>
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ __(
								'Weekly summary link',
								'fair-events-experimental'
							) }
							value={ summaryUrl }
							onChange={ () => {} }
							readOnly
							onFocus={ ( event ) => event.target.select() }
						/>
					</Disclosure>
				</>
			) }
		</section>
	);
}
