<?php
/**
 * Block Patterns for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Patterns;

defined( 'WPINC' ) || die;

/**
 * Patterns class for registering block patterns and pattern categories
 */
class Patterns {
	/**
	 * Initialize patterns
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'init', array( $this, 'register_pattern_categories' ) );
		add_action( 'init', array( $this, 'register_patterns' ) );
	}

	/**
	 * Register pattern categories
	 *
	 * @return void
	 */
	public function register_pattern_categories() {
		register_block_pattern_category(
			'fair-events',
			array(
				'label' => __( 'Fair Events', 'fair-events' ),
			)
		);
	}

	/**
	 * Register block patterns
	 *
	 * @return void
	 */
	public function register_patterns() {
		// Event list with dates using Query Loop
		register_block_pattern(
			'fair-events/event-list',
			array(
				'title'       => __( 'Event List - With Dates', 'fair-events' ),
				'description' => __( 'Display events with title, dates, and excerpt using Query Loop', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'event', 'list', 'query', 'date', 'excerpt' ),
				'content'     => '<!-- wp:query {"query":{"perPage":10,"pages":0,"offset":0,"postType":"fair_event","order":"asc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":false}} -->
<div class="wp-block-query">
	<!-- wp:post-template -->
		<!-- wp:post-title {"isLink":true} /-->
		<!-- wp:fair-events/event-dates /-->
	<!-- /wp:post-template -->
</div>
<!-- /wp:query -->',
			)
		);

		// Event grid with images using Query Loop
		register_block_pattern(
			'fair-events/event-grid',
			array(
				'title'       => __( 'Event Grid', 'fair-events' ),
				'description' => __( 'Display events in a grid layout with images using Query Loop', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'event', 'grid', 'query', 'image' ),
				'content'     => '<!-- wp:query {"query":{"perPage":6,"pages":0,"offset":0,"postType":"fair_event","order":"asc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":false}} -->
<div class="wp-block-query">
	<!-- wp:post-template {"layout":{"type":"grid","columnCount":3}} -->
		<!-- wp:post-featured-image {"isLink":true} /-->
		<!-- wp:post-title {"isLink":true} /-->
		<!-- wp:fair-events/event-dates /-->
	<!-- /wp:post-template -->
</div>
<!-- /wp:query -->',
			)
		);

		// Calendar Event - Simple (title only)
		// Compact pattern designed for calendar cells - shows only event title as a link
		register_block_pattern(
			'fair-events/calendar-event-simple',
			array(
				'title'       => __( 'Calendar Event - Simple', 'fair-events' ),
				'description' => __( 'Display event title only (compact for calendar cells)', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'calendar', 'event', 'simple', 'title' ),
				'content'     => '<!-- wp:post-title {"level":6,"isLink":true,"fontSize":"small"} /-->',
			)
		);

		// Schedule Event - Simple (title only)
		// Compact pattern for weekly schedule - shows only event title
		register_block_pattern(
			'fair-events/schedule-event-simple',
			array(
				'title'       => __( 'Schedule Event - Simple', 'fair-events' ),
				'description' => __( 'Display event title only (no time)', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'schedule', 'event', 'simple', 'title' ),
				'content'     => '<!-- wp:post-title {"level":6,"isLink":true,"fontSize":"small"} /-->',
			)
		);

		// Schedule Event - With Time (start time + title)
		// Pattern for weekly schedule with start time display
		// Note: <time data-event-time="start"></time> is a placeholder
		// that will be replaced with actual event start time during rendering
		register_block_pattern(
			'fair-events/schedule-event-with-time',
			array(
				'title'       => __( 'Schedule Event - With Time', 'fair-events' ),
				'description' => __( 'Display event with start time and title', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'schedule', 'event', 'time', 'start' ),
				'content'     => '<!-- wp:group {"style":{"spacing":{"blockGap":"0.25rem"}},"layout":{"type":"flex","orientation":"vertical"}} -->
<div class="wp-block-group">
	<!-- wp:html -->
	<time data-event-time="start"></time>
	<!-- /wp:html -->
	<!-- wp:post-title {"level":6,"isLink":true,"fontSize":"small"} /-->
</div>
<!-- /wp:group -->',
			)
		);

		// Schedule Event - With Time Range (time range + title)
		// Pattern for weekly schedule with full time range display
		// Note: <time data-event-time="range"></time> is a placeholder
		// that will be replaced with actual event time range during rendering
		register_block_pattern(
			'fair-events/schedule-event-with-time-range',
			array(
				'title'       => __( 'Schedule Event - With Time Range', 'fair-events' ),
				'description' => __( 'Display event with time range and title', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'schedule', 'event', 'time', 'range', 'duration' ),
				'content'     => '<!-- wp:group {"style":{"spacing":{"blockGap":"0.25rem"}},"layout":{"type":"flex","orientation":"vertical"}} -->
<div class="wp-block-group">
	<!-- wp:html -->
	<time data-event-time="range"></time>
	<!-- /wp:html -->
	<!-- wp:post-title {"level":6,"isLink":true,"fontSize":"small"} /-->
</div>
<!-- /wp:group -->',
			)
		);
	}
}
