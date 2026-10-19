<?php
/**
 * Calendar Button hooks for Fair Events
 *
 * Handles the calendar button block variation functionality:
 * - Injects event data from fair_event_dates table into button data attributes
 * - Enqueues frontend script for calendar dropdown
 * - Passes enabled post types to JavaScript
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Helpers\CalendarExport;
use FairEvents\Helpers\EventTiming;
use FairEvents\Helpers\OccurrenceDateParam;
use FairEvents\Helpers\SelectedOccurrence;
use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Handles calendar button block variation hooks
 */
class CalendarButtonHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_filter( 'register_block_type_args', array( $this, 'add_calendar_button_attribute' ), 10, 2 );
		add_filter( 'render_block_core/button', array( $this, 'inject_calendar_data' ), 10, 2 );
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_editor_assets' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'maybe_enqueue_frontend' ) );
	}

	/**
	 * Add isCalendarButton attribute to core/button block
	 *
	 * This filter adds a custom attribute that allows us to identify
	 * calendar button variations of the core/button block.
	 *
	 * @param array  $args       Block registration arguments.
	 * @param string $block_type Block type name.
	 * @return array Modified block registration arguments.
	 */
	public function add_calendar_button_attribute( $args, $block_type ) {
		if ( 'core/button' !== $block_type ) {
			return $args;
		}

		// Add the isCalendarButton attribute.
		if ( ! isset( $args['attributes'] ) ) {
			$args['attributes'] = array();
		}

		$args['attributes']['isCalendarButton'] = array(
			'type'    => 'boolean',
			'default' => false,
		);

		return $args;
	}

	/**
	 * Inject calendar data attributes into button block
	 *
	 * @param string $content Block HTML content.
	 * @param array  $block   Block data including attributes.
	 * @return string Modified block content.
	 */
	public function inject_calendar_data( $content, $block ) {
		// Only process calendar buttons.
		if ( empty( $block['attrs']['isCalendarButton'] ) ) {
			return $content;
		}

		// Get current post.
		$post_id = get_the_ID();
		if ( ! $post_id ) {
			return $content;
		}

		// Check if post type is enabled for events.
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return $content;
		}

		// Get event dates from database. Honors ?event_date=<id> so the
		// calendar button reflects a viewer-picked occurrence (e.g. one
		// specific date out of a recurring series) instead of the master.
		$selection = SelectedOccurrence::select( $post_id );
		if ( ! $selection ) {
			return $content;
		}

		$export = $this->resolve_export( $selection, SelectedOccurrence::resolve( $post_id, $selection['default'] ) );

		// Nothing exportable: no calendar entry may invent the missing time,
		// so the button gets no event data and does nothing when clicked.
		if ( ! $export ) {
			return $this->render_unavailable( $content );
		}

		$event_dates = $export['row'];
		$timing      = EventTiming::range_keys( $event_dates->get_timing() );

		// Get post data for calendar event.
		$title       = get_the_title( $post_id );
		$url         = $export['as_session']
			? add_query_arg( 'event_date', OccurrenceDateParam::format( $event_dates ), get_permalink( $post_id ) )
			: get_permalink( $post_id );
		$description = get_the_excerpt( $post_id );

		// Get location from venue if available, otherwise fall back to the
		// event date's inline address (used when no venue is selected).
		$location = '';
		if ( ! empty( $event_dates->venue_id ) ) {
			$venue = \FairEvents\Models\Venue::get_by_id( $event_dates->venue_id );
			if ( $venue ) {
				$location = $venue->name;
				if ( ! empty( $venue->address ) ) {
					$location .= ', ' . $venue->address;
				}
			}
		}

		if ( empty( $location ) && ! empty( $event_dates->address ) ) {
			$location = $event_dates->address;
		}

		$rrule     = $export['rrule'];
		$recurring = ! empty( $rrule );

		// Build data attributes. Exportable timing has both ends, so these
		// are its real values, never substitutes.
		$data_attrs = sprintf(
			'data-calendar-button="true" data-start="%s" data-end="%s" data-all-day="%s" data-title="%s" data-url="%s" data-location="%s" data-description="%s" data-recurring="%s" data-rrule="%s"',
			esc_attr( $timing['start'] ),
			esc_attr( $timing['end'] ),
			$event_dates->all_day ? 'true' : 'false',
			esc_attr( $title ),
			esc_attr( $url ),
			esc_attr( $location ),
			esc_attr( $description ),
			$recurring ? 'true' : 'false',
			esc_attr( $rrule )
		);

		return $this->add_link_attributes( $content, $data_attrs );
	}

	/**
	 * Choose what the button exports, following the calendar export policy
	 * (see CalendarExport): only an exportable date, and a recurrence rule
	 * only when no date of the series is left out.
	 *
	 * A recurring event's overview exports what it shows (today's or the
	 * next date, or the series with its rule) when every date of the series
	 * is exportable. When some are not, it exports the next exportable date
	 * that has not ended, on its own. A selected session exports itself.
	 *
	 * @param array      $selection Selection from SelectedOccurrence::select().
	 * @param EventDates $shown     Row the page shows (SelectedOccurrence::resolve()).
	 * @return array{row: EventDates, rrule: string, as_session: bool}|null
	 *         The row to export, its rule, and whether the link should name
	 *         that session; null when nothing is exportable.
	 */
	private function resolve_export( array $selection, EventDates $shown ) {
		$series = $selection['series'];

		if ( $series && SelectedOccurrence::SESSION !== $selection['state'] ) {
			$dates = array_filter(
				array_merge( array( $series ), EventDates::get_generated_by_master_id( (int) $series->id ) ),
				function ( $row ) {
					return 'active' === $row->status;
				}
			);

			$timings = array_map(
				function ( $row ) {
					return $row->get_timing();
				},
				$dates
			);

			if ( ! CalendarExport::all_exportable( $timings ) ) {
				$next = CalendarExport::next_exportable( $timings, current_time( 'mysql' ) );

				return null === $next ? null : array(
					'row'        => $dates[ $next ],
					'rrule'      => '',
					'as_session' => true,
				);
			}
		}

		if ( ! EventTiming::is_calendar_exportable( $shown->get_timing() ) ) {
			return null;
		}

		return array(
			'row'        => $shown,
			'rrule'      => (string) ( $shown->rrule ?? '' ),
			'as_session' => false,
		);
	}

	/**
	 * Show the button as unavailable, with the reason next to it.
	 *
	 * The link loses its destination and points at a visible explanation
	 * through `aria-describedby`, so the reason is read out and shown
	 * without hovering.
	 *
	 * @param string $content Block HTML content.
	 * @return string Modified block content.
	 */
	private function render_unavailable( $content ) {
		$note_id = wp_unique_id( 'fair-events-calendar-unavailable-' );

		// Drop the link's destination: nothing to open or download.
		$content = preg_replace( '/(<a\s[^>]*?)\shref="[^"]*"/', '$1', $content, 1 );

		$content = $this->add_link_attributes(
			$content,
			sprintf(
				'data-calendar-button="true" data-calendar-available="false" aria-disabled="true" aria-describedby="%s"',
				esc_attr( $note_id )
			)
		);

		$note = sprintf(
			'<p class="fair-events-calendar-unavailable" id="%s">%s</p>',
			esc_attr( $note_id ),
			esc_html__( 'Both start and end times are required to add this event to a calendar.', 'fair-events' )
		);

		return preg_replace( '/<\/a>/', '</a>' . $note, $content, 1 );
	}

	/**
	 * Add attributes to the button's link.
	 *
	 * @param string $content    Block HTML content.
	 * @param string $attributes Escaped attribute markup.
	 * @return string Modified block content.
	 */
	private function add_link_attributes( $content, $attributes ) {
		// The button is an <a> tag with the wp-block-button__link class,
		// possibly after other attributes and classes. Only the first link
		// is the button's.
		return preg_replace(
			'/<a\s+([^>]*?)class="([^"]*?)wp-block-button__link/',
			'<a $1' . $attributes . ' class="$2wp-block-button__link',
			$content,
			1
		);
	}

	/**
	 * Enqueue editor assets
	 *
	 * @return void
	 */
	public function enqueue_editor_assets() {
		$script_path = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/editor.js';
		$script_url  = FAIR_EVENTS_PLUGIN_URL . 'build/blocks/calendar-button/editor.js';

		if ( ! file_exists( $script_path ) ) {
			return;
		}

		$asset_file = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/editor.asset.php';
		$asset      = file_exists( $asset_file )
			? require $asset_file
			: array(
				'dependencies' => array( 'wp-blocks', 'wp-data', 'wp-i18n', 'wp-dom-ready' ),
				'version'      => filemtime( $script_path ),
			);

		wp_enqueue_script(
			'fair-events-calendar-button-editor',
			$script_url,
			$asset['dependencies'],
			$asset['version'],
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);

		// Pass enabled post types to JavaScript.
		wp_localize_script(
			'fair-events-calendar-button-editor',
			'fairEventsData',
			array( 'enabledPostTypes' => Settings::get_enabled_post_types() )
		);

		// Set script translations.
		wp_set_script_translations(
			'fair-events-calendar-button-editor',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);
	}

	/**
	 * Maybe enqueue frontend assets
	 *
	 * Only enqueues if viewing a single post of an enabled type.
	 *
	 * @return void
	 */
	public function maybe_enqueue_frontend() {
		if ( ! is_singular() ) {
			return;
		}

		$post_id       = get_the_ID();
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();

		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return;
		}

		// Check if the post has event dates.
		$event_dates = EventDates::get_by_event_id( $post_id );
		if ( ! $event_dates ) {
			return;
		}

		$script_path = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/frontend.js';
		$script_url  = FAIR_EVENTS_PLUGIN_URL . 'build/blocks/calendar-button/frontend.js';

		if ( ! file_exists( $script_path ) ) {
			return;
		}

		$asset_file = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/frontend.asset.php';
		$asset      = file_exists( $asset_file )
			? require $asset_file
			: array(
				'dependencies' => array( 'wp-i18n' ),
				'version'      => filemtime( $script_path ),
			);

		wp_enqueue_script(
			'fair-events-calendar-button-frontend',
			$script_url,
			$asset['dependencies'],
			$asset['version'],
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);

		// Enqueue the CSS.
		$style_path = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/frontend.css';
		$style_url  = FAIR_EVENTS_PLUGIN_URL . 'build/blocks/calendar-button/frontend.css';

		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				'fair-events-calendar-button-frontend',
				$style_url,
				array(),
				$asset['version']
			);
		}

		// Set script translations.
		wp_set_script_translations(
			'fair-events-calendar-button-frontend',
			'fair-events',
			\FairEvents\Core\Features::script_translations_path()
		);
	}
}
