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

// Get block attributes
$time_filter     = $attributes['timeFilter'] ?? 'upcoming';
$categories      = $attributes['categories'] ?? array();
$display_pattern = $attributes['displayPattern'] ?? 'default';

// Build query arguments using custom table
$query_args = array(
	'post_type'              => 'fair_event',
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

		// Check if this is a fair_event query or if post_type is not set
		if ( isset( $query['post_type'] ) && $query['post_type'] === 'fair_event' ) {
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
