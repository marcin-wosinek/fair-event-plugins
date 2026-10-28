import { useEffect, useState } from '@wordpress/element';
import {
	PanelBody,
	SelectControl,
	Notice,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Problem with the weekly-update settings, for the editor to show.
 *
 * @param {Object}      settings
 * @param {string}      settings.weeklyUpdate  'hidden', 'unchecked' or 'checked'.
 * @param {string}      settings.feedSelection 'multiselect' or 'hidden'.
 * @param {number}      settings.feedId        Configured feed for the hidden mode.
 * @param {Object|null} settings.feeds         Loaded `{ available, feeds }`, or null while loading.
 * @return {{status: string, message: string}|null} Notice, or null when nothing needs attention.
 */
export function weeklySettingsNotice( {
	weeklyUpdate,
	feedSelection,
	feedId,
	feeds,
} ) {
	if ( weeklyUpdate === 'hidden' || ! feeds ) {
		return null;
	}

	if ( ! feeds.available ) {
		return {
			status: 'warning',
			message: __(
				'Event feeds are not available. Activate Fair Events to offer weekly updates; until then the form says they are not available.',
				'fair-audience'
			),
		};
	}

	if ( feeds.feeds.length === 0 ) {
		return {
			status: 'warning',
			message: __(
				'No event feed has a weekly update yet. Set one up in Fair Events; until then the form says weekly updates are not available.',
				'fair-audience'
			),
		};
	}

	if ( feedSelection !== 'hidden' ) {
		return null;
	}

	if ( ! feedId ) {
		return {
			status: 'warning',
			message: __(
				'Choose the event feed subscribers receive.',
				'fair-audience'
			),
		};
	}

	if ( ! feeds.feeds.some( ( feed ) => feed.id === feedId ) ) {
		return {
			status: 'error',
			message: __(
				'The chosen event feed no longer has a weekly update. Choose another one; until then the form says weekly updates are not available.',
				'fair-audience'
			),
		};
	}

	return null;
}

/**
 * Inspector panel configuring the weekly-update controls of the form.
 *
 * @param {Object}   props
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Block attribute setter.
 */
export default function WeeklyUpdatePanel( { attributes, setAttributes } ) {
	const { weeklyUpdate, feedSelection, feedId } = attributes;
	const [ feeds, setFeeds ] = useState( null );
	const [ loadError, setLoadError ] = useState( false );
	const shown = weeklyUpdate !== 'hidden';

	useEffect( () => {
		if ( ! shown || feeds ) {
			return;
		}
		let active = true;
		apiFetch( { path: '/fair-audience/v1/mailing-signup/weekly-feeds' } )
			.then( ( response ) => {
				if ( active ) {
					setFeeds( response );
				}
			} )
			.catch( () => {
				if ( active ) {
					setLoadError( true );
				}
			} );
		return () => {
			active = false;
		};
	}, [ shown, feeds ] );

	const notice = weeklySettingsNotice( {
		weeklyUpdate,
		feedSelection,
		feedId,
		feeds,
	} );
	const feedOptions = feeds?.feeds ?? [];
	const missingFeed =
		feedId > 0 && ! feedOptions.some( ( feed ) => feed.id === feedId );

	return (
		<PanelBody title={ __( 'Weekly update', 'fair-audience' ) }>
			<SelectControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'Weekly update checkbox', 'fair-audience' ) }
				value={ weeklyUpdate }
				options={ [
					{
						value: 'hidden',
						label: __( 'Not shown', 'fair-audience' ),
					},
					{
						value: 'unchecked',
						label: __( 'Shown, unchecked', 'fair-audience' ),
					},
					{
						value: 'checked',
						label: __( 'Shown, checked', 'fair-audience' ),
					},
				] }
				onChange={ ( value ) =>
					setAttributes( { weeklyUpdate: value } )
				}
				help={ __(
					'Let subscribers sign up for a weekly email of upcoming events. When not shown, the form leaves weekly emails as they are.',
					'fair-audience'
				) }
			/>
			{ shown && (
				<SelectControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Event feeds', 'fair-audience' ) }
					value={ feedSelection }
					options={ [
						{
							value: 'multiselect',
							label: __(
								'Subscribers choose feeds',
								'fair-audience'
							),
						},
						{
							value: 'hidden',
							label: __( 'One feed, not shown', 'fair-audience' ),
						},
					] }
					onChange={ ( value ) =>
						setAttributes( { feedSelection: value } )
					}
					help={
						feedSelection === 'hidden'
							? __(
									'Subscribers who check the weekly update receive this feed only.',
									'fair-audience'
								)
							: __(
									'Subscribers choose from every feed with a weekly update; none is selected at first.',
									'fair-audience'
								)
					}
				/>
			) }
			{ shown && ! feeds && ! loadError && <Spinner /> }
			{ shown && loadError && (
				<Notice status="error" isDismissible={ false }>
					{ __(
						'Event feeds could not be loaded. Please reload the editor.',
						'fair-audience'
					) }
				</Notice>
			) }
			{ shown && feedSelection === 'hidden' && feedOptions.length > 0 && (
				<SelectControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Event feed', 'fair-audience' ) }
					value={ String( feedId || 0 ) }
					options={ [
						{
							value: missingFeed ? String( feedId ) : '0',
							label: missingFeed
								? __( 'Unavailable feed', 'fair-audience' )
								: __( 'Choose an event feed', 'fair-audience' ),
							disabled: true,
						},
						...feedOptions.map( ( feed ) => ( {
							value: String( feed.id ),
							label: feed.name,
						} ) ),
					] }
					onChange={ ( value ) =>
						setAttributes( { feedId: parseInt( value, 10 ) || 0 } )
					}
				/>
			) }
			{ notice && (
				<Notice status={ notice.status } isDismissible={ false }>
					{ notice.message }
				</Notice>
			) }
		</PanelBody>
	);
}
