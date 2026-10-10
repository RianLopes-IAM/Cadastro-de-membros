export type Sex = 'male' | 'female' | 'not_informed';
export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed' | 'separated' | 'stable_union';
export type AdmissionType = 'baptism' | 'transfer_letter' | 'profession_of_faith' | 'acclamation';
export interface ChildInput { name: string; birthDate: string | null; }
export interface MemberDetails {
  photoId: string | null;
  sex: Sex | null;
  birthCountry: string | null;
  birthCity: string | null;
  fatherName: string | null;
  motherName: string | null;
  profession: string | null;
  maritalStatus: MaritalStatus | null;
  weddingDate: string | null;
  spouseName: string | null;
  children: ChildInput[];
  baptismChurch: string | null;
  baptismDate: string | null;
  baptismPastor: string | null;
  admissionType: AdmissionType | null;
  leftAt: string | null;
}

export const emptyMemberDetails: MemberDetails = {
  photoId: null, sex: null, birthCountry: null, birthCity: null, fatherName: null, motherName: null,
  profession: null, maritalStatus: null, weddingDate: null, spouseName: null, children: [],
  baptismChurch: null, baptismDate: null, baptismPastor: null, admissionType: null, leftAt: null,
};

export function memberDetails(input: Partial<MemberDetails>): MemberDetails {
  const result = Object.fromEntries(Object.entries(emptyMemberDetails).map(([key, fallback]) => [
    key, input[key as keyof MemberDetails] === undefined ? fallback : input[key as keyof MemberDetails],
  ])) as unknown as MemberDetails;
  result.children = result.children.map(child => ({ name: child.name, birthDate: child.birthDate }));
  return result;
}

export function timelineErrors(input: Partial<MemberDetails> & { birthDate?: string | null; joinedAt?: string }): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of ['weddingDate', 'baptismDate', 'joinedAt'] as const) {
    if (input.birthDate && input[field] && input[field]! < input.birthDate) errors[field] = ['A data não pode ser anterior ao nascimento.'];
  }
  if (input.leftAt && input.joinedAt && input.leftAt < input.joinedAt) errors.leftAt = ['A saída não pode ser anterior à entrada.'];
  input.children?.forEach((child, index) => {
    if (child.birthDate && input.birthDate && child.birthDate < input.birthDate) {
      errors[`children.${index}.birthDate`] = ['O nascimento do filho não pode ser anterior ao nascimento do membro.'];
    }
  });
  return errors;
}
