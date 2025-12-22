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
		register_block_pattern(
			'fair-events/calendar-event-simple',
			array(
				'title'       => __( 'Calendar Event - Simple', 'fair-events' ),
				'description' => __( 'Display event title only (compact for calendar cells)', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'calendar', 'event', 'simple', 'title' ),
				'content'     => '<!-- wp:post-title {"level":5,"isLink":true,"fontSize":"small"} /-->',
			)
		);

		// Calendar Event - With Time (start time + title)
		register_block_pattern(
			'fair-events/calendar-event-with-time',
			array(
				'title'       => __( 'Calendar Event - With Time', 'fair-events' ),
				'description' => __( 'Display event with start time (compact for calendar cells)', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'calendar', 'event', 'time' ),
				'content'     => '<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap"},"style":{"spacing":{"blockGap":"0.25rem"}}} -->
<div class="wp-block-group">
	<!-- wp:fair-events/event-dates {"showEndDate":false,"showTime":true,"fontSize":"x-small"} /-->
	<!-- wp:post-title {"level":6,"isLink":true,"fontSize":"small"} /-->
</div>
<!-- /wp:group -->',
			)
		);
	}
}
