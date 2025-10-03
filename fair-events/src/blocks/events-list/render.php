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

/**
 * Render event based on selected pattern
 *
 * @param WP_Post $post Event post object.
 * @param string  $pattern Pattern name.
 */
if ( ! function_exists( 'fair_events_render_event_with_pattern' ) ) {
	function fair_events_render_event_with_pattern( $post, $pattern ) {
		setup_postdata( $post );

		// If pattern is 'default' or pattern doesn't exist, use default rendering
		if ( 'default' === $pattern ) {
			?>
			<li class="event-item">
				<h3 class="event-title">
					<a href="<?php the_permalink(); ?>">
						<?php the_title(); ?>
					</a>
				</h3>
				<?php if ( has_excerpt() ) : ?>
					<div class="event-excerpt">
						<?php the_excerpt(); ?>
					</div>
				<?php endif; ?>
			</li>
			<?php
		} elseif ( 'fair-events/single-event' === $pattern ) {
			// Pattern: Title as link + excerpt
			?>
			<li class="event-item event-item-simple">
				<?php the_title( '<h3 class="event-title"><a href="' . esc_url( get_permalink() ) . '">', '</a></h3>' ); ?>
				<?php if ( has_excerpt() ) : ?>
					<div class="event-excerpt">
						<?php the_excerpt(); ?>
					</div>
				<?php endif; ?>
			</li>
			<?php
		} elseif ( 'fair-events/single-event-with-image' === $pattern ) {
			// Pattern: Featured image + title as link + excerpt
			?>
			<li class="event-item event-item-with-image">
				<?php if ( has_post_thumbnail() ) : ?>
					<div class="event-image">
						<a href="<?php the_permalink(); ?>">
							<?php the_post_thumbnail( 'medium' ); ?>
						</a>
					</div>
				<?php endif; ?>
				<?php the_title( '<h3 class="event-title"><a href="' . esc_url( get_permalink() ) . '">', '</a></h3>' ); ?>
				<?php if ( has_excerpt() ) : ?>
					<div class="event-excerpt">
						<?php the_excerpt(); ?>
					</div>
				<?php endif; ?>
			</li>
			<?php
		} else {
			// Fallback to default for unknown patterns
			?>
			<li class="event-item">
				<h3 class="event-title">
					<a href="<?php the_permalink(); ?>">
						<?php the_title(); ?>
					</a>
				</h3>
				<?php if ( has_excerpt() ) : ?>
					<div class="event-excerpt">
						<?php the_excerpt(); ?>
					</div>
				<?php endif; ?>
			</li>
			<?php
		}

		wp_reset_postdata();
	}
}
?>

<div <?php echo get_block_wrapper_attributes(); ?>>
	<?php if ( $events_query->have_posts() ) : ?>
		<ul class="wp-block-fair-events-events-list wp-block-fair-events-events-list--<?php echo esc_attr( str_replace( '/', '-', $display_pattern ) ); ?>">
			<?php
			while ( $events_query->have_posts() ) :
				$events_query->the_post();
				fair_events_render_event_with_pattern( get_post(), $display_pattern );
			endwhile;
			?>
		</ul>
	<?php else : ?>
		<p class="no-events">
			<?php esc_html_e( 'No events found matching the criteria.', 'fair-events' ); ?>
		</p>
	<?php endif; ?>
</div>

<?php
wp_reset_postdata();
