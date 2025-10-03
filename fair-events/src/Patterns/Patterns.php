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
		// Single event with title and excerpt
		register_block_pattern(
			'fair-events/single-event',
			array(
				'title'       => __( 'Featured Event', 'fair-events' ),
				'description' => __( 'Display a single event with title (as link) and excerpt', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'event', 'single', 'featured', 'excerpt' ),
				'content'     => '<!-- wp:post-title {"isLink":true} /-->
		<!-- wp:post-excerpt /-->',
			)
		);

		// Single event with featured image, title, and excerpt
		register_block_pattern(
			'fair-events/single-event-with-image',
			array(
				'title'       => __( 'Featured Event with Image', 'fair-events' ),
				'description' => __( 'Display a single event with featured image, title (as link), and excerpt', 'fair-events' ),
				'categories'  => array( 'fair-events' ),
				'keywords'    => array( 'event', 'single', 'featured', 'image', 'excerpt' ),
				'content'     => '<!-- wp:post-featured-image {"isLink":true} /-->
		<!-- wp:post-title {"isLink":true} /-->
		<!-- wp:post-excerpt /-->',
			)
		);
	}
}
