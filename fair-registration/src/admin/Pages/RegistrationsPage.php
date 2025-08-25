<?php
/**
 * Registrations page for Fair Registration admin
 *
 * @package FairRegistration
 */

namespace FairRegistration\Admin\Pages;

defined( 'WPINC' ) || die;

/**
 * Registrations page class
 */
class RegistrationsPage {

	/**
	 * Render the registrations page
	 *
	 * @param int $form_id Optional. Specific form ID to show registrations for.
	 * @return void
	 */
	public function render( $form_id = null ) {
		// Get form_id from URL parameter if not provided
		if ( ! $form_id && isset( $_GET['form_id'] ) ) {
			$form_id = intval( $_GET['form_id'] );
		}

		$registrations = $this->get_registrations( $form_id );
		$form_title = $form_id ? get_the_title( $form_id ) : '';
		?>
		<div class="wrap">
			<?php if ( $form_id ) : ?>
				<h1>
					<?php printf( 
						esc_html__( 'Registrations: %s', 'fair-registration' ), 
						esc_html( $form_title ) 
					); ?>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-registration' ) ); ?>" class="page-title-action">
						<?php echo esc_html__( '← Back to Forms', 'fair-registration' ); ?>
					</a>
				</h1>
			<?php else : ?>
				<h1><?php echo esc_html__( 'All Registrations', 'fair-registration' ); ?></h1>
			<?php endif; ?>
			
			<div class="card">
				<?php if ( $form_id ) : ?>
					<h2><?php printf( esc_html__( 'Registrations for "%s"', 'fair-registration' ), esc_html( $form_title ) ); ?></h2>
				<?php else : ?>
					<h2><?php echo esc_html__( 'Recent Registrations', 'fair-registration' ); ?></h2>
				<?php endif; ?>
				
				<div class="tablenav top">
					<div class="alignleft actions">
						<?php if ( ! $form_id ) : ?>
							<select name="form_filter" id="form-filter">
								<option value=""><?php echo esc_html__( 'All Forms', 'fair-registration' ); ?></option>
								<?php 
								$forms = $this->get_forms_with_registrations();
								foreach ( $forms as $form ) : ?>
									<option value="<?php echo esc_attr( $form->ID ); ?>">
										<?php echo esc_html( get_the_title( $form->ID ) ); ?>
									</option>
								<?php endforeach; ?>
							</select>
						<?php endif; ?>
						
						<select name="bulk-action" id="bulk-action-selector-top">
							<option value="-1"><?php echo esc_html__( 'Bulk Actions', 'fair-registration' ); ?></option>
							<option value="delete"><?php echo esc_html__( 'Delete', 'fair-registration' ); ?></option>
							<option value="export"><?php echo esc_html__( 'Export', 'fair-registration' ); ?></option>
						</select>
						<input type="submit" class="button action" value="<?php echo esc_attr__( 'Apply', 'fair-registration' ); ?>" />
					</div>
					
					<div class="tablenav-pages">
						<span class="displaying-num">
							<?php printf( esc_html__( '%d items', 'fair-registration' ), count( $registrations ) ); ?>
						</span>
					</div>
				</div>
				
				<?php if ( empty( $registrations ) ) : ?>
					<div class="notice notice-info">
						<p><?php echo esc_html__( 'No registrations found.', 'fair-registration' ); ?></p>
						<?php if ( $form_id ) : ?>
							<p><?php echo esc_html__( 'This form has not received any registrations yet.', 'fair-registration' ); ?></p>
						<?php endif; ?>
					</div>
				<?php else : ?>
					<table class="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<td class="manage-column column-cb check-column">
									<input type="checkbox" id="cb-select-all-1" />
								</td>
								<th scope="col" class="manage-column column-name">
									<?php echo esc_html__( 'Name', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-email">
									<?php echo esc_html__( 'Email', 'fair-registration' ); ?>
								</th>
								<?php if ( ! $form_id ) : ?>
								<th scope="col" class="manage-column column-form">
									<?php echo esc_html__( 'Form', 'fair-registration' ); ?>
								</th>
								<?php endif; ?>
								<th scope="col" class="manage-column column-date">
									<?php echo esc_html__( 'Date', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-status">
									<?php echo esc_html__( 'Status', 'fair-registration' ); ?>
								</th>
								<th scope="col" class="manage-column column-actions">
									<?php echo esc_html__( 'Actions', 'fair-registration' ); ?>
								</th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $registrations as $registration ) : ?>
								<tr>
									<th scope="row" class="check-column">
										<input type="checkbox" name="registration[]" value="<?php echo esc_attr( $registration['id'] ); ?>" />
									</th>
									<td class="column-name">
										<strong><?php echo esc_html( $registration['name'] ); ?></strong>
									</td>
									<td class="column-email">
										<a href="mailto:<?php echo esc_attr( $registration['email'] ); ?>">
											<?php echo esc_html( $registration['email'] ); ?>
										</a>
									</td>
									<?php if ( ! $form_id ) : ?>
									<td class="column-form">
										<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-registration-registrations&form_id=' . $registration['form_id'] ) ); ?>">
											<?php echo esc_html( get_the_title( $registration['form_id'] ) ); ?>
										</a>
									</td>
									<?php endif; ?>
									<td class="column-date">
										<?php echo esc_html( $registration['date'] ); ?>
									</td>
									<td class="column-status">
										<span class="status-<?php echo esc_attr( $registration['status'] ); ?>">
											<?php echo esc_html( ucfirst( $registration['status'] ) ); ?>
										</span>
									</td>
									<td class="column-actions">
										<button type="button" class="button button-small" onclick="viewRegistrationDetails(<?php echo esc_attr( $registration['id'] ); ?>)">
											<?php echo esc_html__( 'View Details', 'fair-registration' ); ?>
										</button>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>
			</div>
		</div>

		<script>
		function viewRegistrationDetails(registrationId) {
			// TODO: Implement modal or navigation to detailed view
			alert('Registration details for ID: ' + registrationId);
		}
		</script>

		<style>
		.status-pending { color: #f56e28; }
		.status-confirmed { color: #00a32a; }
		.status-cancelled { color: #d63638; }
		</style>
		<?php
	}

	/**
	 * Get registrations for a specific form or all registrations
	 *
	 * @param int $form_id Optional. Form ID to filter by.
	 * @return array Array of registration data
	 */
	private function get_registrations( $form_id = null ) {
		// Mock data for now - replace with actual database queries later
		$mock_registrations = array(
			array(
				'id' => 1,
				'name' => 'John Doe',
				'email' => 'john.doe@example.com',
				'form_id' => 123,
				'date' => '2024-01-15 10:30:00',
				'status' => 'confirmed'
			),
			array(
				'id' => 2,
				'name' => 'Jane Smith',
				'email' => 'jane.smith@example.com',
				'form_id' => 123,
				'date' => '2024-01-14 14:22:00',
				'status' => 'pending'
			),
			array(
				'id' => 3,
				'name' => 'Bob Wilson',
				'email' => 'bob.wilson@example.com',
				'form_id' => 456,
				'date' => '2024-01-13 09:15:00',
				'status' => 'confirmed'
			)
		);

		// Filter by form_id if provided
		if ( $form_id ) {
			$mock_registrations = array_filter( $mock_registrations, function( $registration ) use ( $form_id ) {
				return $registration['form_id'] == $form_id;
			});
		}

		return $mock_registrations;
	}

	/**
	 * Get all forms that have registrations
	 *
	 * @return array Array of post objects
	 */
	private function get_forms_with_registrations() {
		// For now, return mock data - implement actual query later
		$mock_forms = array(
			(object) array( 'ID' => 123 ),
			(object) array( 'ID' => 456 )
		);

		return $mock_forms;
	}
}