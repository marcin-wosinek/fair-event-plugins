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

// Build query arguments
$query_args = array(
	'post_type'      => 'fair_event',
	'posts_per_page' => -1,
	'orderby'        => 'meta_value',
	'meta_key'       => 'event_start',
	'order'          => 'ASC',
);

// Add category filter if categories are selected
if ( ! empty( $categories ) ) {
	$query_args['category__in'] = $categories;
}

// Add time-based meta query
$current_time = current_time( 'Y-m-d\TH:i' );

switch ( $time_filter ) {
	case 'upcoming':
		$query_args['meta_query'] = array(
			array(
				'key'     => 'event_start',
				'value'   => $current_time,
				'compare' => '>=',
				'type'    => 'DATETIME',
			),
		);
		break;

	case 'past':
		$query_args['meta_query'] = array(
			array(
				'key'     => 'event_end',
				'value'   => $current_time,
				'compare' => '<',
				'type'    => 'DATETIME',
			),
		);
		$query_args['order']      = 'DESC';
		break;

	case 'ongoing':
		$query_args['meta_query'] = array(
			'relation' => 'AND',
			array(
				'key'     => 'event_start',
				'value'   => $current_time,
				'compare' => '<=',
				'type'    => 'DATETIME',
			),
			array(
				'key'     => 'event_end',
				'value'   => $current_time,
				'compare' => '>=',
				'type'    => 'DATETIME',
			),
		);
		break;

	case 'all':
	default:
		// No time filter
		break;
}

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
			// Merge our custom query args (time filters, categories, meta queries)
			// Keep the Query Loop's own settings but add our filters
			if ( isset( $query_args['meta_query'] ) ) {
				$query['meta_query'] = $query_args['meta_query'];
			}
			if ( isset( $query_args['category__in'] ) ) {
				$query['category__in'] = $query_args['category__in'];
			}
			if ( isset( $query_args['meta_key'] ) ) {
				$query['meta_key'] = $query_args['meta_key'];
			}
			if ( isset( $query_args['orderby'] ) ) {
				$query['orderby'] = $query_args['orderby'];
			}
			if ( isset( $query_args['order'] ) ) {
				$query['order'] = $query_args['order'];
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
wp_reset_postdata();
