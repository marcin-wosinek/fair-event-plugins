<?php
/**
 * Events List Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

use FairEvents\Settings\Settings;
use FairEvents\Models\EventDates;

// Get block attributes
$time_filter        = $attributes['timeFilter'] ?? 'upcoming';
$categories         = $attributes['categories'] ?? array();
$display_pattern    = $attributes['displayPattern'] ?? 'default';
$event_source_slugs = $attributes['eventSources'] ?? array();

// Build query arguments using custom table
$query_args = array(
	'post_type'              => Settings::get_enabled_post_types(),
	'posts_per_page'         => -1,
	'fair_events_date_query' => true,
	'fair_events_order'      => 'ASC',
);

// Add category filter if categories are selected
if ( ! empty( $categories ) ) {
	// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
	$query_args['tax_query'] = array(
		array(
			'taxonomy'         => 'category',
			'field'            => 'term_id',
			'terms'            => $categories,
			'include_children' => false,
		),
	);
}

// Add time-based query using custom table
$current_time = current_time( 'Y-m-d H:i:s' );

switch ( $time_filter ) {
	case 'upcoming':
		$query_args['fair_events_date_query'] = array(
			'start_after' => $current_time,
		);
		break;

	case 'past':
		$query_args['fair_events_date_query'] = array(
			'end_before' => $current_time,
		);
		$query_args['fair_events_order']      = 'DESC';
		break;

	case 'ongoing':
		$query_args['fair_events_date_query'] = array(
			'start_before' => $current_time,
			'end_after'    => $current_time,
		);
		break;

	case 'all':
	default:
		// No time filter, but still use custom table for ordering
		break;
}

// Hook in the QueryHelper filters
add_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10, 2 );
add_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10, 2 );
add_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10, 2 );

// Execute the query
$events_query = new WP_Query( $query_args );

// Ensure query always includes fair_event post type (for Query Loop patterns)
// This filter will be applied to any nested Query blocks
// We need to use a flag to only apply this during our block's rendering
$fair_events_apply_filter = true;

add_filter(
	'query_loop_block_query_vars',
	function ( $query, $block ) use ( $query_args, &$fair_events_apply_filter ) {
		// Only apply if we're rendering a fair-events pattern
		if ( ! $fair_events_apply_filter ) {
			return $query;
		}

		// Check if query post_type overlaps with enabled event post types
		$enabled_post_types = Settings::get_enabled_post_types();
		$query_post_type    = $query['post_type'] ?? '';

		// Handle both string and array post types
		$is_event_query = false;
		if ( is_array( $query_post_type ) ) {
			$is_event_query = ! empty( array_intersect( $query_post_type, $enabled_post_types ) );
		} else {
			$is_event_query = in_array( $query_post_type, $enabled_post_types, true );
		}

		if ( $is_event_query ) {
			// Merge our custom query args (time filters, categories, custom table queries)
			// Keep the Query Loop's own settings but add our filters
			if ( isset( $query_args['fair_events_date_query'] ) ) {
				$query['fair_events_date_query'] = $query_args['fair_events_date_query'];
			}
			if ( isset( $query_args['fair_events_order'] ) ) {
				$query['fair_events_order'] = $query_args['fair_events_order'];
			}
			if ( isset( $query_args['tax_query'] ) ) {
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
				$query['tax_query'] = $query_args['tax_query'];
			}
		}

		return $query;
	},
	10,
	2
);

// Check if pattern uses Query Loop (contains wp:query or wp:post-template)
$is_query_loop_pattern = false;
$pattern_content       = '';

if ( strpos( $display_pattern, 'wp_block:' ) === 0 ) {
	// User-created pattern (reusable block)
	$block_id   = str_replace( 'wp_block:', '', $display_pattern );
	$block_post = get_post( $block_id );
	if ( $block_post && 'wp_block' === $block_post->post_type ) {
		$pattern_content = $block_post->post_content;
	}
} else {
	// PHP-registered pattern
	$all_patterns = WP_Block_Patterns_Registry::get_instance()->get_all_registered();

	// Find the pattern by name
	foreach ( $all_patterns as $pattern ) {
		if ( isset( $pattern['name'] ) && $pattern['name'] === $display_pattern ) {
			$pattern_content = $pattern['content'];
			break;
		}
	}
}

$is_query_loop_pattern = ( strpos( $pattern_content, '<!-- wp:query' ) !== false ||
							strpos( $pattern_content, '<!-- wp:post-template' ) !== false );

// Fetch iCal events from selected event sources
$all_ical_events = array();

if ( ! empty( $event_source_slugs ) && is_array( $event_source_slugs ) ) {
	$repository = new \FairEvents\Database\EventSourceRepository();

	foreach ( $event_source_slugs as $slug ) {
		// Skip if not a string
		if ( ! is_string( $slug ) ) {
			continue;
		}

		$source = $repository->get_by_slug( $slug );

		// Skip disabled or non-existent sources
		if ( ! $source || ! $source['enabled'] ) {
			continue;
		}

		// Process each data source within the event source
		foreach ( $source['data_sources'] as $data_source ) {
			if ( 'ical_url' === $data_source['source_type'] ) {
				$ical_feed_url   = $data_source['config']['url'] ?? '';
				$ical_feed_color = $data_source['config']['color'] ?? '#4caf50';

				if ( ! empty( $ical_feed_url ) ) {
					$fetched_events = \FairEvents\ICalParser::fetch_and_parse( $ical_feed_url );

					// Filter based on timeFilter attribute
					switch ( $time_filter ) {
						case 'upcoming':
							$filtered_events = array_filter(
								$fetched_events,
								function ( $event ) {
									return strtotime( $event['start'] ) >= time();
								}
							);
							break;
						case 'past':
							$filtered_events = array_filter(
								$fetched_events,
								function ( $event ) {
									return strtotime( $event['end'] ) < time();
								}
							);
							break;
						case 'ongoing':
							$filtered_events = array_filter(
								$fetched_events,
								function ( $event ) {
									$now = time();
									return strtotime( $event['start'] ) <= $now && strtotime( $event['end'] ) >= $now;
								}
							);
							break;
						case 'all':
						default:
							$filtered_events = $fetched_events;
							break;
					}

					// Add color to each event
					foreach ( $filtered_events as $event ) {
						$event['source_color'] = $ical_feed_color;
						$all_ical_events[]     = $event;
					}
				}
			}
		}
	}

	// Sort iCal events by start date
	usort(
		$all_ical_events,
		function ( $a, $b ) use ( $time_filter ) {
			$time_a = strtotime( $a['start'] );
			$time_b = strtotime( $b['start'] );

			// For 'past' filter, sort descending
			if ( 'past' === $time_filter ) {
				return $time_b - $time_a;
			}

			// Default: sort ascending
			return $time_a - $time_b;
		}
	);
}
?>

<div <?php echo wp_kses_post( get_block_wrapper_attributes() ); ?>>
	<?php if ( $is_query_loop_pattern && $pattern_content ) : ?>
		<?php
		// For Query Loop patterns, render the pattern with query context
		// Parse and render blocks
		$parsed_blocks = parse_blocks( $pattern_content );

		// Render the blocks - the filter will apply query modifications
		foreach ( $parsed_blocks as $parsed_block ) {
			echo wp_kses_post( render_block( $parsed_block ) );
		}

		// Disable the filter after rendering
		$fair_events_apply_filter = false;
		?>
	<?php elseif ( $pattern_content ) : ?>
		<?php
		// For non-Query Loop patterns, render WordPress events + iCal events + standalone events
		// Get WordPress events from the query
		$wp_events = array();
		if ( $events_query->have_posts() ) {
			while ( $events_query->have_posts() ) {
				$events_query->the_post();
				$wp_events[] = array(
					'type'  => 'wordpress',
					'post'  => get_post(),
					'start' => get_post_meta( get_the_ID(), 'start_date', true ),
				);
			}
		}

		// Fetch standalone events based on time filter
		$standalone_events_raw = array();
		switch ( $time_filter ) {
			case 'upcoming':
				// Get standalone events starting after now
				$standalone_events_raw = EventDates::get_standalone_for_date_range(
					$current_time,
					'2099-12-31 23:59:59',
					$categories
				);
				break;
			case 'past':
				// Get standalone events ending before now
				$standalone_events_raw = EventDates::get_standalone_for_date_range(
					'1970-01-01 00:00:00',
					$current_time,
					$categories
				);
				break;
			case 'ongoing':
				// Get standalone events spanning now
				$standalone_events_raw = EventDates::get_standalone_for_date_range(
					$current_time,
					$current_time,
					$categories
				);
				break;
			case 'all':
			default:
				$standalone_events_raw = EventDates::get_standalone_for_date_range(
					'1970-01-01 00:00:00',
					'2099-12-31 23:59:59',
					$categories
				);
				break;
		}

		// Merge WordPress events with iCal events
		$all_events = $wp_events;
		foreach ( $all_ical_events as $ical_event ) {
			$all_events[] = array(
				'type'  => 'ical',
				'event' => $ical_event,
				'start' => $ical_event['start'],
			);
		}

		// Add standalone events
		foreach ( $standalone_events_raw as $standalone_event ) {
			$all_events[] = array(
				'type'       => 'standalone',
				'event_date' => $standalone_event,
				'start'      => $standalone_event->start_datetime,
			);
		}

		// Sort combined events by start date
		usort(
			$all_events,
			function ( $a, $b ) use ( $time_filter ) {
				$time_a = strtotime( $a['start'] );
				$time_b = strtotime( $b['start'] );

				// For 'past' filter, sort descending
				if ( 'past' === $time_filter ) {
					return $time_b - $time_a;
				}

				// Default: sort ascending
				return $time_a - $time_b;
			}
		);

		// Render each event using the pattern
		foreach ( $all_events as $event_data ) {
			// Determine event type and color
			$event_type    = $event_data['type'];
			$event_classes = array( 'event-list-item' );
			$event_style   = '';

			if ( 'ical' === $event_type ) {
				// iCal event - get color from source
				$event_classes[] = 'is-ical';
				$ical_event      = $event_data['event'];
				$event_color     = $ical_event['source_color'] ?? '#4caf50';

				// Convert color to CSS value
				if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $event_color ) ) {
					$bg_color_value = $event_color;
				} else {
					$bg_color_value = 'var(--wp--preset--color--' . esc_attr( $event_color ) . ')';
				}

				$event_style = 'style="--event-bg-color: ' . esc_attr( $bg_color_value ) . '; --event-text-color: #ffffff;"';
			} elseif ( 'standalone' === $event_type ) {
				// Standalone event (external/unlinked)
				$event_classes[] = 'is-standalone';
				$standalone      = $event_data['event_date'];
				if ( 'external' === $standalone->link_type ) {
					$event_classes[] = 'is-external';
				} else {
					$event_classes[] = 'is-unlinked';
				}
			} else {
				// WordPress event
				$event_classes[] = 'is-wordpress';
			}

			// Open event wrapper
			echo '<div class="' . esc_attr( implode( ' ', $event_classes ) ) . '" ' . $event_style . '>';

			if ( 'ical' === $event_type ) {
				// Create a temporary context for pattern rendering
				$pattern_with_data = str_replace(
					array( '{{title}}', '{{start}}', '{{end}}', '{{location}}', '{{description}}' ),
					array(
						esc_html( $ical_event['summary'] ?? '' ),
						esc_html( $ical_event['start'] ?? '' ),
						esc_html( $ical_event['end'] ?? '' ),
						esc_html( $ical_event['location'] ?? '' ),
						esc_html( $ical_event['description'] ?? '' ),
					),
					$pattern_content
				);

				// Parse and render the pattern with data
				$parsed_blocks = parse_blocks( $pattern_with_data );
				foreach ( $parsed_blocks as $parsed_block ) {
					echo wp_kses_post( render_block( $parsed_block ) );
				}
			} elseif ( 'standalone' === $event_type ) {
				// Render standalone event with simple display
				$standalone  = $event_data['event_date'];
				$event_title = $standalone->get_display_title();
				$event_url   = $standalone->get_display_url();
				$is_external = 'external' === $standalone->link_type;
				?>
				<div class="standalone-event-content">
					<?php if ( $is_external && ! empty( $event_url ) ) : ?>
						<a href="<?php echo esc_url( $event_url ); ?>"
							class="event-title"
							target="_blank"
							rel="noopener noreferrer">
							<?php echo esc_html( $event_title ); ?>
						</a>
					<?php else : ?>
						<span class="event-title"><?php echo esc_html( $event_title ); ?></span>
					<?php endif; ?>
				</div>
				<?php
			} else {
				// Set up post data for WordPress events
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
				$GLOBALS['post'] = $event_data['post'];
				setup_postdata( $event_data['post'] );

				// Parse and render the pattern
				$parsed_blocks = parse_blocks( $pattern_content );
				foreach ( $parsed_blocks as $parsed_block ) {
					echo wp_kses_post( render_block( $parsed_block ) );
				}
			}

			// Close event wrapper
			echo '</div>';
		}

		wp_reset_postdata();
		?>
	<?php else : ?>
		<p class="no-events">
			<?php esc_html_e( 'No events found. Please select a valid display pattern.', 'fair-events' ); ?>
		</p>
	<?php endif; ?>
</div>

<?php
// Remove the filters after the query is complete
remove_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10 );
remove_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10 );
remove_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10 );

wp_reset_postdata();
