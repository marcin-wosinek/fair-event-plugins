<?php
/**
 * Forms list page for Fair Registration admin
 *
 * @package FairRegistration
 */

namespace FairRegistration\Admin\Pages;

defined( 'WPINC' ) || die;

/**
 * Forms list page class
 */
class FormsListPage {

	/**
	 * Render the forms list page
	 *
	 * @return void
	 */
	public function render() {
		$forms = $this->get_published_forms();
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Registration Forms', 'fair-registration' ); ?></h1>
			
			<div class="card">
				<h2><?php echo esc_html__( 'Published Forms', 'fair-registration' ); ?></h2>
				<p><?php echo esc_html__( 'Forms that contain registration blocks and are published on your website.', 'fair-registration' ); ?></p>
				
				<?php if ( empty( $forms ) ) : ?>
					<div class="notice notice-info">
						<p><?php echo esc_html__( 'No published forms with registration blocks found.', 'fair-registration' ); ?></p>
						<p>
							<?php echo esc_html__( 'To create a registration form:', 'fair-registration' ); ?>
							<br>1. <?php echo esc_html__( 'Create a new page or post', 'fair-registration' ); ?>
							<br>2. <?php echo esc_html__( 'Add a "Registration Form" block', 'fair-registration' ); ?>
							<br>3. <?php echo esc_html__( 'Publish the page', 'fair-registration' ); ?>
						</p>
					</div>
				<?php else : ?>
					<table class="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<th scope="col" class="manage-column column-title">
									<?php echo esc_html__( 'Form Title', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-type">
									<?php echo esc_html__( 'Type', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-date">
									<?php echo esc_html__( 'Date Published', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-registrations">
									<?php echo esc_html__( 'Registrations', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-actions">
									<?php echo esc_html__( 'Actions', 'fair-registration' ); ?>
								</th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $forms as $form ) : ?>
								<tr>
									<td class="column-title">
										<strong>
											<a href="<?php echo esc_url( get_permalink( $form->ID ) ); ?>" target="_blank">
												<?php echo esc_html( get_the_title( $form->ID ) ); ?>
											</a>
										</strong>
									</td>
									<td class="column-type">
										<?php echo esc_html( ucfirst( $form->post_type ) ); ?>
									</td>
									<td class="column-date">
										<?php echo esc_html( get_the_date( 'Y/m/d', $form->ID ) ); ?>
									</td>
									<td class="column-registrations">
										<?php 
										$registration_count = $this->get_registration_count( $form->ID );
										echo esc_html( $registration_count );
										?>
									</td>
									<td class="column-actions">
										<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-registration-registrations&form_id=' . $form->ID ) ); ?>" class="button button-small">
											<?php echo esc_html__( 'View Registrations', 'fair-registration' ); ?>
										</a>
										<a href="<?php echo esc_url( get_edit_post_link( $form->ID ) ); ?>" class="button button-small">
											<?php echo esc_html__( 'Edit Form', 'fair-registration' ); ?>
										</a>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>
			</div>
		</div>
		<?php
	}

	/**
	 * Get all published posts/pages that contain registration forms
	 *
	 * @return array Array of post objects
	 */
	private function get_published_forms() {
		$args = array(
			'post_type'      => array( 'post', 'page' ),
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'meta_query'     => array(
				'relation' => 'OR',
				array(
					'key'     => '_has_registration_form',
					'value'   => '1',
					'compare' => '='
				)
			)
		);

		$query = new \WP_Query( $args );
		$posts_with_forms = array();

		if ( $query->have_posts() ) {
			while ( $query->have_posts() ) {
				$query->the_post();
				$post = get_post();
				
				// Double check if post actually contains registration form block
				if ( has_block( 'fair-registration/form', $post ) ) {
					$posts_with_forms[] = $post;
				}
			}
			wp_reset_postdata();
		}

		// Also search by content if no meta found
		if ( empty( $posts_with_forms ) ) {
			$args = array(
				'post_type'      => array( 'post', 'page' ),
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				's'              => 'wp:fair-registration/form'
			);

			$query = new \WP_Query( $args );
			if ( $query->have_posts() ) {
				while ( $query->have_posts() ) {
					$query->the_post();
					$post = get_post();
					
					if ( has_block( 'fair-registration/form', $post ) ) {
						$posts_with_forms[] = $post;
					}
				}
				wp_reset_postdata();
			}
		}

		return $posts_with_forms;
	}

	/**
	 * Get registration count for a specific form
	 *
	 * @param int $form_id Post ID containing the form
	 * @return int Registration count
	 */
	private function get_registration_count( $form_id ) {
		// For now return 0, will implement actual counting later
		// This would typically query a custom table or post meta
		return 0;
	}
}