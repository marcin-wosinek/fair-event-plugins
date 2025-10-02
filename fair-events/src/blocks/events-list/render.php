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
$time_filter = $attributes['timeFilter'] ?? 'upcoming';
$categories  = $attributes['categories'] ?? array();

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

// Get WordPress date and time formats
$date_format = get_option( 'date_format' );
$time_format = get_option( 'time_format' );
?>

<div <?php echo get_block_wrapper_attributes(); ?>>
	<?php if ( $events_query->have_posts() ) : ?>
		<ul class="wp-block-fair-events-events-list">
			<?php
			while ( $events_query->have_posts() ) :
				$events_query->the_post();
				$event_start   = get_post_meta( get_the_ID(), 'event_start', true );
				$event_end     = get_post_meta( get_the_ID(), 'event_end', true );
				$event_all_day = get_post_meta( get_the_ID(), 'event_all_day', true );
				?>
				<li class="event-item">
					<h3 class="event-title">
						<a href="<?php the_permalink(); ?>">
							<?php the_title(); ?>
						</a>
					</h3>

					<?php if ( $event_start || $event_end ) : ?>
						<div class="event-meta">
							<?php if ( $event_start ) : ?>
								<div class="event-start">
									<strong><?php esc_html_e( 'Start:', 'fair-events' ); ?></strong>
									<?php
									$start_timestamp = strtotime( $event_start );
									if ( $start_timestamp ) {
										echo esc_html( wp_date( $date_format . ' ' . $time_format, $start_timestamp ) );
									}
									?>
								</div>
							<?php endif; ?>

							<?php if ( $event_end ) : ?>
								<div class="event-end">
									<strong><?php esc_html_e( 'End:', 'fair-events' ); ?></strong>
									<?php
									$end_timestamp = strtotime( $event_end );
									if ( $end_timestamp ) {
										echo esc_html( wp_date( $date_format . ' ' . $time_format, $end_timestamp ) );
									}
									?>
								</div>
							<?php endif; ?>

							<?php if ( $event_all_day ) : ?>
								<div class="event-all-day">
									<strong><?php esc_html_e( 'All Day Event', 'fair-events' ); ?></strong>
								</div>
							<?php endif; ?>
						</div>
					<?php endif; ?>

					<?php if ( has_excerpt() ) : ?>
						<div class="event-excerpt">
							<?php the_excerpt(); ?>
						</div>
					<?php endif; ?>
				</li>
			<?php endwhile; ?>
		</ul>
	<?php else : ?>
		<p class="no-events">
			<?php esc_html_e( 'No events found matching the criteria.', 'fair-events' ); ?>
		</p>
	<?php endif; ?>
</div>

<?php
wp_reset_postdata();
