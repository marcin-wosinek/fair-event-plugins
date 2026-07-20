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
use FairEvents\Services\EventFeedProvider;

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
		// For non-Query Loop patterns, render post-linked, standalone, and
		// external (iCal/API) occurrences from the shared feed provider.
		// `null` bounds are open-ended; the provider resolves them
		// internally instead of callers hardcoding sentinel dates.
		switch ( $time_filter ) {
			case 'upcoming':
				$range_start = $current_time;
				$range_end   = null;
				break;
			case 'past':
				$range_start = null;
				$range_end   = $current_time;
				break;
			case 'ongoing':
				$range_start = $current_time;
				$range_end   = $current_time;
				break;
			case 'all':
			default:
				$range_start = null;
				$range_end   = null;
				break;
		}

		$provider = new EventFeedProvider();

		$occurrences = $provider->get_occurrences(
			$range_start,
			$range_end,
			array(
				'categories'         => $categories,
				'event_source_slugs' => is_array( $event_source_slugs ) ? $event_source_slugs : array(),
			)
		);

		// The provider sorts ascending; 'past' displays most recent first.
		if ( 'past' === $time_filter ) {
			$occurrences = array_reverse( $occurrences );
		}

		// Render each occurrence using the pattern
		foreach ( $occurrences as $occurrence ) {
			$is_external_source = in_array( $occurrence['source'], array( 'ical', 'api' ), true );

			$event_classes = array( 'event-list-item' );
			$event_style   = '';

			if ( $is_external_source ) {
				// External event - get color from source
				$event_classes[] = 'is-ical';
				$event_color     = ! empty( $occurrence['source_color'] ) ? $occurrence['source_color'] : '#4caf50';

				// Convert color to CSS value
				if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $event_color ) ) {
					$bg_color_value = $event_color;
				} else {
					$bg_color_value = 'var(--wp--preset--color--' . esc_attr( $event_color ) . ')';
				}

				$event_style = '--event-bg-color: ' . $bg_color_value . '; --event-text-color: #ffffff;';
			} elseif ( 'standalone' === $occurrence['source'] ) {
				$event_classes[] = 'is-standalone';
			} else {
				$event_classes[] = 'is-wordpress';
			}

			if ( ! empty( $occurrence['is_draft'] ) ) {
				$event_classes[] = 'is-draft';
			}

			// Open event wrapper
			echo '<div class="' . esc_attr( implode( ' ', $event_classes ) ) . '"' . ( '' !== $event_style ? ' style="' . esc_attr( $event_style ) . '"' : '' ) . '>';

			if ( $is_external_source ) {
				// Create a temporary context for pattern rendering
				$pattern_with_data = str_replace(
					array( '{{title}}', '{{start}}', '{{end}}', '{{location}}', '{{description}}' ),
					array(
						esc_html( $occurrence['title'] ),
						esc_html( $occurrence['start'] ),
						esc_html( $occurrence['end'] ),
						'',
						esc_html( $occurrence['description'] ),
					),
					$pattern_content
				);

				// Parse and render the pattern with data
				$parsed_blocks = parse_blocks( $pattern_with_data );
				foreach ( $parsed_blocks as $parsed_block ) {
					echo wp_kses_post( render_block( $parsed_block ) );
				}
			} elseif ( 'standalone' === $occurrence['source'] ) {
				// Render standalone event with simple display
				?>
				<div class="standalone-event-content">
					<?php if ( ! empty( $occurrence['url'] ) ) : ?>
						<a href="<?php echo esc_url( $occurrence['url'] ); ?>" class="event-title">
							<?php echo esc_html( $occurrence['title'] ); ?>
						</a>
					<?php else : ?>
						<span class="event-title"><?php echo esc_html( $occurrence['title'] ); ?></span>
					<?php endif; ?>
				</div>
				<?php
			} else {
				// Set up post data for post-linked events
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
				$GLOBALS['post'] = get_post( $occurrence['event_id'] );
				setup_postdata( $GLOBALS['post'] );

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
